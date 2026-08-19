# 资讯流右键新闻卡片送入对话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资讯流单条新闻右键，将新闻以卡片形式强制发进新对话做分析（解读 / 持仓影响 / 下一步 / 相关个股）。

**Architecture:** 右键只组装 `NewsCardPayload`。`ChatContext.requestNewsCardAnalysis` 先 `newSession` + `ensureActiveSession`（失败则留在资讯流），再跳转 `/chat`。ChatView 消费 pending 后走现有 `submit-input`，主进程把 `news_card` 原样 POST 到 `/chat`。UI 存 `news_card` 块；LLM user 消息为「短意图 + `<news_card>` JSON 附件」。`requestPrefill` / Toast / 个股 / 组合不改。

**Tech Stack:** Electron IPC、React + TypeScript、`python/api.py`、`fin_agent.agent.core.FinAgent.stream_chat`。

**Spec:** `docs/superpowers/specs/2026-08-19-news-context-menu-design.md`

## Global Constraints

- 菜单只放分析动作，不含打开原文、复制、标记已读。
- 只做单条；不实现多选。
- 始终新开对话再发送；即使当前会话空闲也不写入旧会话。
- 用户气泡是新闻卡片，不是「标题：…内容：…」长文；不把卡片塞进 `fa-prefill` / `sessionStorage` 字符串通道，不复用 `fa-prefill-send`。
- 不新增 Agent 新闻工具；不按 `news_id` 回查本地库。
- `requestPrefill(text)`、Toast `buildNewsImpactPrefill`、个股体检、组合诊断行为不变。
- 面向用户文案用简体中文。
- 不生成 Mock；不编译项目；不写自动化测试；实现后由用户按 spec §7 手工验收。
- 未经用户明确要求不要 git commit。

---

## File Map

| 文件 | 职责 |
|------|------|
| `src/renderer/src/utils/chatPrefill.ts` | 意图枚举、短意图文案、快照组装、菜单出现条件 |
| `src/renderer/src/contexts/ChatContext.tsx` | `ChatBlock` 增加 `news_card`；`requestNewsCardAnalysis` + pending |
| `src/renderer/src/components/news/NewsChatCard.tsx` | **新建** 对话里的新闻卡片 |
| `src/renderer/src/components/news/NewsFeedContextMenu.tsx` | **新建** 应用内右键菜单 |
| `src/renderer/src/components/news/NewsFeedTab.tsx` | 右键/菜单键、出现条件、调用分析入口 |
| `src/renderer/src/components/ChatView.tsx` | 渲染卡片；消费 pending；`onNewMessage` 带 `newsCard` |
| `src/renderer/src/index.css` | 右键菜单 + 对话卡片微调 |
| `src/preload/index.ts` / `src/renderer/src/env.d.ts` / `src/main/index.ts` | `submit-input` / `new-message` 增加可选 `newsCard` |
| `python/api.py` | `/chat` 读 `news_card`；标题生成用新闻标题 |
| `python/fin-agent/fin_agent/agent/core.py` | `stream_chat(..., news_card=)` 写成短意图+附件 |

---

### Task 1: 新闻卡片 payload 与菜单辅助函数

**Files:**
- Modify: `src/renderer/src/utils/chatPrefill.ts`

**Interfaces:**
- Consumes: `NotifiedNewsItem`（`env.d.ts`）、`matchNewsToHoldings` / `NewsHolding`（`newsPortfolioMatch.ts`）、`normalizeNewsUrl`（`news.ts`）
- Produces:
  - `NewsCardIntent`
  - `NewsCardSnapshot`
  - `NewsCardPayload`
  - `NEWS_CARD_INTENT_LABELS`
  - `NEWS_CARD_INTENT_PROMPTS`
  - `NEWS_CARD_FIXED_MENU: { intent: NewsCardIntent; label: string }[]`
  - `relatedSymbolsForNews(item, holdings) => string[]`
  - `shouldShowRelatedStocksMenu(item, holdings) => boolean`
  - `buildNewsCardPayload(intent, item, holdings) => NewsCardPayload | null`

- [ ] **Step 1: 在 `chatPrefill.ts` 末尾追加（保留现有 `buildNewsImpactPrefill` 不动）**

```ts
import { matchNewsToHoldings, type NewsHolding } from './newsPortfolioMatch'
import { normalizeNewsUrl } from './news'

export type NewsCardIntent = 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'

export interface NewsCardSnapshot {
  id: string
  title: string
  summary: string
  url: string
  source: string
  published_at: string
  sentiment?: string | null
  matched_symbols: string[]
}

export interface NewsCardPayload {
  intent: NewsCardIntent
  news: NewsCardSnapshot
}

export const NEWS_CARD_INTENT_LABELS: Record<NewsCardIntent, string> = {
  interpret: '解读',
  portfolio_impact: '持仓影响',
  next_actions: '下一步',
  related_stocks: '相关个股'
}

export const NEWS_CARD_INTENT_PROMPTS: Record<NewsCardIntent, string> = {
  interpret: '请解读这条新闻',
  portfolio_impact: '请分析这条新闻对我当前持仓的影响',
  next_actions: '请根据这条新闻给出可执行的下一步',
  related_stocks: '请分析这条新闻涉及的相关个股'
}

export const NEWS_CARD_FIXED_MENU: { intent: NewsCardIntent; label: string }[] = [
  { intent: 'interpret', label: '解读这条新闻' },
  { intent: 'portfolio_impact', label: '对我持仓的影响' },
  { intent: 'next_actions', label: '接下来可以做什么' }
]

export function relatedSymbolsForNews(
  item: NotifiedNewsItem,
  holdings: NewsHolding[]
): string[] {
  const fromItem = item.matched_symbols || []
  const fromHoldings = matchNewsToHoldings(`${item.title}\n${item.summary || ''}`, holdings)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...fromItem, ...fromHoldings]) {
    const value = (raw || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function shouldShowRelatedStocksMenu(
  item: NotifiedNewsItem,
  holdings: NewsHolding[]
): boolean {
  return relatedSymbolsForNews(item, holdings).length > 0
}

export function buildNewsCardPayload(
  intent: NewsCardIntent,
  item: NotifiedNewsItem,
  holdings: NewsHolding[]
): NewsCardPayload | null {
  const title = (item.title || '').trim()
  if (!title) return null
  if (intent === 'related_stocks' && !shouldShowRelatedStocksMenu(item, holdings)) return null
  return {
    intent,
    news: {
      id: item.id,
      title,
      summary: item.summary || '',
      url: normalizeNewsUrl(item.url) || '',
      source: item.source,
      published_at: item.published_at || '',
      sentiment: item.sentiment || null,
      matched_symbols: relatedSymbolsForNews(item, holdings)
    }
  }
}
```

把 `import { matchNewsToHoldings...` 放在文件顶部现有导出之前，不要重复导入。

- [ ] **Step 2: 手工核对**

打开文件确认：`buildAnalyzeStockPrefill` / `buildPortfolioDiagnosePrefill` / `buildNewsImpactPrefill` 一字未改；新类型与 spec §3.1 / §4.2 字段名一致。

---

### Task 2: 模型侧短意图 + 附件

**Files:**
- Modify: `python/fin-agent/fin_agent/agent/core.py`
- Modify: `python/api.py`（`_handle_chat_stream`）

**Interfaces:**
- Consumes: `/chat` JSON 的 `message`（短意图，可忽略若有 card）与 `news_card: { intent, news }`
- Produces: `format_news_card_user_message(news_card: dict) -> str`；`FinAgent.stream_chat(user_input, news_card=None)`

- [ ] **Step 1: 在 `core.py` 的 `_fit_messages_for_llm` 之后、`class FinAgent` 之前插入**

```python
_NEWS_CARD_INTENT_PROMPTS = {
    "interpret": "请解读这条新闻",
    "portfolio_impact": "请分析这条新闻对我当前持仓的影响",
    "next_actions": "请根据这条新闻给出可执行的下一步",
    "related_stocks": "请分析这条新闻涉及的相关个股",
}


def format_news_card_user_message(news_card):
    """把资讯流卡片编成模型 user 文本：短意图 + 附件，不是用户手打长文。"""
    if not isinstance(news_card, dict):
        return ""
    intent = str(news_card.get("intent") or "interpret").strip()
    prompt = _NEWS_CARD_INTENT_PROMPTS.get(intent, _NEWS_CARD_INTENT_PROMPTS["interpret"])
    news = news_card.get("news") if isinstance(news_card.get("news"), dict) else news_card
    payload = {
        "id": news.get("id") or "",
        "title": news.get("title") or "",
        "summary": news.get("summary") or "",
        "url": news.get("url") or "",
        "source": news.get("source") or "",
        "published_at": news.get("published_at") or "",
        "sentiment": news.get("sentiment"),
        "matched_symbols": news.get("matched_symbols") or [],
    }
    return (
        f"{prompt}\n\n<news_card>\n"
        f"{json.dumps(payload, ensure_ascii=False)}\n"
        "</news_card>"
    )
```

- [ ] **Step 2: 改 `stream_chat` 签名与写入历史**

把 `def stream_chat(self, user_input):` 改为 `def stream_chat(self, user_input, news_card=None):`。

把「Append user input」那段换成：

```python
        user_content = user_input
        if news_card:
            formatted = format_news_card_user_message(news_card)
            if formatted:
                user_content = formatted
        self.history.append({"role": "user", "content": user_content})
        self.history = _shrink_tool_payloads(self.history)
```

`debug_print` 仍用 `user_content[:50]`，避免 `user_input` 为空时切片报错。

- [ ] **Step 3: 改 `api.py` `_handle_chat_stream`**

在 `user_input = data.get('message')` 后增加：

```python
            news_card = data.get("news_card")
            if news_card is not None and not isinstance(news_card, dict):
                news_card = None
```

将 `active_agent.stream_chat(user_input)` 改为 `active_agent.stream_chat(user_input, news_card=news_card)`。

将 `maybe_generate_title(session_id, user_input)` 改为：

```python
                    title_seed = user_input
                    if isinstance(news_card, dict):
                        news = news_card.get("news") if isinstance(news_card.get("news"), dict) else {}
                        title_seed = (news.get("title") or "").strip() or user_input
                    maybe_generate_title(session_id, title_seed)
```

- [ ] **Step 4: 手工核对**

确认 `run()` 仍调用 `self.stream_chat(user_input)`（`news_card` 默认 `None`）。CLI 不受影响。

---

### Task 3: IPC 传递 `newsCard`

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/main/index.ts`（`submit-input` handler，约 1929 行起）

**Interfaces:**
- Consumes: Task 1 的 `NewsCardPayload` 形状（preload 用内联类型，避免 preload 引用 renderer 路径）
- Produces:
  - `window.api.submitInput(text: string, sessionId?: string, newsCard?: NewsCardPayload)`
  - `onNewMessage` payload：`{ text: string; sessionId?: string; newsCard?: NewsCardPayload } | string`

- [ ] **Step 1: `env.d.ts` 在 `NotifiedNewsItem` 附近或 `Window.api` 之前增加（若已在 chatPrefill 定义，此处重复一份 interface 供全局，或直接引用不到 chatPrefill——preload/env 保持独立拷贝）**

在 `declare interface Window` 之前加入：

```ts
type NewsCardIntent = 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'

interface NewsCardSnapshot {
  id: string
  title: string
  summary: string
  url: string
  source: string
  published_at: string
  sentiment?: string | null
  matched_symbols: string[]
}

interface NewsCardPayload {
  intent: NewsCardIntent
  news: NewsCardSnapshot
}

interface ChatNewMessagePayload {
  text: string
  sessionId?: string
  newsCard?: NewsCardPayload
}
```

把 `submitInput` 改为：

```ts
    submitInput: (text: string, sessionId?: string, newsCard?: NewsCardPayload) => void
```

把 `onNewMessage` 改为：

```ts
    onNewMessage: (
      callback: (payload: ChatNewMessagePayload | string) => void
    ) => () => void
```

- [ ] **Step 2: `preload/index.ts`**

`onNewMessageBridge` 泛型改为 `ChatNewMessagePayload | string`（在 preload 内联同样的 interface，或用 `any` 以外的显式结构）：

```ts
type NewsCardPayload = {
  intent: 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'
  news: {
    id: string
    title: string
    summary: string
    url: string
    source: string
    published_at: string
    sentiment?: string | null
    matched_symbols: string[]
  }
}

type ChatNewMessagePayload = {
  text: string
  sessionId?: string
  newsCard?: NewsCardPayload
}

const onNewMessageBridge = createChannelBridge<ChatNewMessagePayload | string>('new-message')
```

`submitInput` 改为：

```ts
  submitInput: (text: string, sessionId?: string, newsCard?: NewsCardPayload) =>
    ipcRenderer.send('submit-input', text, sessionId, newsCard),
```

`InputView` 现有 `submitInput(value)` / `submitInput('')` 第三参省略，保持兼容。

- [ ] **Step 3: `src/main/index.ts` 的 `ipcMain.on('submit-input', ...)`**

签名改为 `(_, text, sessionId?: string, newsCard?: NewsCardPayload)`。

空文本仍直接 `return`（短意图不会为空）。

`new-message` 改为：

```ts
      chatWindow.webContents.send('new-message', { text: trimmed, sessionId, newsCard })
```

POST body 改为：

```ts
        const postBody: Record<string, unknown> = { message: trimmed, session_id: sessionId }
        if (newsCard && typeof newsCard === 'object') {
          postBody.news_card = newsCard
        }
        const postData = JSON.stringify(postBody)
```

不要把 `newsCard` 拼进 `message` 字符串。

- [ ] **Step 4: 手工核对**

`InputView.tsx` 无需修改。确认没有其它 `submitInput(` 调用被破坏（目前还有 `ChatView.sendUserText`）。

---

### Task 4: 对话里渲染新闻卡片，并消费 pending 发送

**Files:**
- Create: `src/renderer/src/components/news/NewsChatCard.tsx`
- Modify: `src/renderer/src/contexts/ChatContext.tsx`（仅 `ChatBlock` 联合类型；pending API 在 Task 5）
- Modify: `src/renderer/src/components/ChatView.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: Task 1 标签/来源工具；Task 3 的 `newsCard` 回声
- Produces: 用户消息若含 `blocks` 里 `type === 'news_card'`，渲染 `NewsChatCard`，不渲染 `msg.content` 长文

- [ ] **Step 1: 扩展 `ChatContext.tsx` 的 `ChatBlock`**

在现有 `ChatBlock` 联合类型上增加：

```ts
  | {
      type: 'news_card'
      intent: 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'
      news: {
        id: string
        title: string
        summary: string
        url: string
        source: string
        published_at: string
        sentiment?: string | null
        matched_symbols: string[]
      }
    }
```

- [ ] **Step 2: 创建 `NewsChatCard.tsx`**

```tsx
import React from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import { MarkdownExternalLink } from '../ExternalLink'
import {
  NEWS_SOURCE_LABELS,
  NEWS_SENTIMENT_LABELS,
  formatNewsTime,
  hasNewsUrl,
  sentimentBadgeClass
} from '../../utils/news'
import { NEWS_CARD_INTENT_LABELS, type NewsCardPayload } from '../../utils/chatPrefill'

const NewsChatCard: React.FC<{ payload: NewsCardPayload }> = ({ payload }) => {
  const { intent, news } = payload
  const linkable = hasNewsUrl(news)
  return (
    <div className="fa-news-chat-card">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="fa-news-chat-intent">{NEWS_CARD_INTENT_LABELS[intent]}</span>
        {news.sentiment ? (
          <span className={sentimentBadgeClass(news.sentiment as NewsSentiment)}>
            {NEWS_SENTIMENT_LABELS[news.sentiment as NewsSentiment]}
          </span>
        ) : null}
        <span className={`fa-news-item-kind ${linkable ? 'fa-news-item-kind--link' : 'fa-news-item-kind--summary'}`}>
          {linkable ? '原文' : '仅摘要'}
        </span>
      </div>
      <div className="flex items-start gap-1.5">
        {linkable ? (
          <MarkdownExternalLink href={news.url} className="fa-news-item-title fa-news-item-title--link min-w-0 flex-1 font-medium">
            {news.title}
          </MarkdownExternalLink>
        ) : (
          <h3 className="fa-news-item-title min-w-0 flex-1 font-medium">{news.title}</h3>
        )}
        {linkable ? (
          <ExternalLink size={13} className="mt-0.5 shrink-0 text-[var(--fa-faint)]" aria-hidden />
        ) : (
          <FileText size={13} className="mt-0.5 shrink-0 text-[var(--fa-faint)]" aria-hidden />
        )}
      </div>
      {news.summary ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--fa-muted)]">{news.summary}</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--fa-faint)]">
        <span>{NEWS_SOURCE_LABELS[news.source as NewsSource] || news.source}</span>
        <span>{formatNewsTime(news.published_at)}</span>
        {news.matched_symbols.map((symbol) => (
          <span key={symbol} className="fa-news-tag">
            {symbol}
          </span>
        ))}
      </div>
    </div>
  )
}

export default NewsChatCard
```

若 `MarkdownExternalLink` 不适合（它按 Markdown `a` 设计），改为 `window.api.openExternal(news.url)` 的 `<button>`/`<a onClick>`，与资讯流左键一致，仍走系统浏览器。

- [ ] **Step 3: `index.css` 追加**

```css
  .fa-news-chat-card {
    @apply w-full max-w-[min(100%,28rem)] rounded-2xl border px-4 py-3 text-left;
    border-color: var(--fa-border);
    background: var(--fa-surface);
  }

  .fa-news-chat-intent {
    @apply inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium;
    color: var(--fa-accent);
    background: var(--fa-accent-soft);
  }
```

- [ ] **Step 4: `ChatView.tsx` 用户气泡**

`import NewsChatCard from './news/NewsChatCard'`

在 `displayMessages.map` 里，用户消息改为：

```tsx
                  {msg.role === 'user' ? (
                    (() => {
                      const card = (msg.blocks || []).find((b) => b.type === 'news_card')
                      if (card && card.type === 'news_card') {
                        return (
                          <NewsChatCard
                            payload={{ intent: card.intent, news: card.news }}
                          />
                        )
                      }
                      return msg.content
                    })()
                  ) : (
```

有 `news_card` 时去掉外层 `fa-user-bubble` 的纯色气泡（避免卡片套气泡）。做法：外层 `className` 在 user+card 时改用 `max-w-[min(90%,28rem)] p-0 bg-transparent`，无卡片时保持 `fa-user-bubble`。

- [ ] **Step 5: `onNewMessage` 写入卡片块**

把现在的：

```ts
        applyToSession(sid, (prev) => [...prev, { role: 'user', content: text, blocks: [] }])
```

改为读取 `newsCard`：

```ts
      const newsCard = typeof payload === 'string' ? undefined : payload?.newsCard
      ...
        applyToSession(sid, (prev) => [
          ...prev,
          newsCard
            ? {
                role: 'user',
                content: newsCard.news.title,
                blocks: [{ type: 'news_card', intent: newsCard.intent, news: newsCard.news }]
              }
            : { role: 'user', content: text, blocks: [] }
        ])
```

`content` 只存标题，兼容旧逻辑；气泡走 blocks。

本任务先不接 pending 发送（Task 5）。先保证：若 IPC 带回 `newsCard`，界面就是卡片。

- [ ] **Step 6: 手工核对**

普通打字发送仍是右侧文本气泡。历史会话无 `news_card` 块时仍显示 `msg.content`。

---

### Task 5: `requestNewsCardAnalysis`（强制新会话，不走 prefill 字符串）

**Files:**
- Modify: `src/renderer/src/contexts/ChatContext.tsx`
- Modify: `src/renderer/src/components/ChatView.tsx`

**Interfaces:**
- Consumes: `NewsCardPayload`、`NEWS_CARD_INTENT_PROMPTS`、`ensureActiveSession`、`newSession`、`submitInput`
- Produces:
  - `requestNewsCardAnalysis(payload: NewsCardPayload) => Promise<void>`
  - `consumePendingNewsCardSend() => { payload: NewsCardPayload; sessionId: string } | null`
  - 自定义事件名：`fa-news-card-send`（仅作唤醒，真正数据在 ref 里）

- [ ] **Step 1: ChatContext 增加 pending ref 与 API**

在 `PREFILL_STORAGE_KEY` 旁：

```ts
const NEWS_CARD_SEND_EVENT = 'fa-news-card-send'
```

在 `ChatProvider` 内：

```ts
  const pendingNewsCardRef = useRef<{ payload: NewsCardPayload; sessionId: string } | null>(null)

  const consumePendingNewsCardSend = useCallback(() => {
    const pending = pendingNewsCardRef.current
    pendingNewsCardRef.current = null
    return pending
  }, [])

  const requestNewsCardAnalysis = useCallback(
    async (payload: NewsCardPayload) => {
      const title = (payload?.news?.title || '').trim()
      if (!title) return

      try {
        const status = await window.api.checkConfig()
        if (!status.configured) {
          navigate('/config')
          return
        }
      } catch {
        navigate('/config')
        return
      }

      await newSession()
      let sessionId: string
      try {
        sessionId = await ensureActiveSession(title)
      } catch (err) {
        console.error('[ChatContext] requestNewsCardAnalysis ensureActiveSession failed:', err)
        throw new Error('新建对话失败，请稍后重试')
      }

      pendingNewsCardRef.current = { payload, sessionId }
      navigate('/chat')
      window.dispatchEvent(new CustomEvent(NEWS_CARD_SEND_EVENT))
    },
    [ensureActiveSession, navigate, newSession]
  )
```

在 `ChatContextType` 增加这两个方法；Provider `value` 一并导出。

**禁止**写入 `sessionStorage` 的 `fa-prefill`，**禁止** dispatch `fa-prefill-send`。

`requestPrefill` 函数体保持原样。

需要 `import type { NewsCardPayload } from '../utils/chatPrefill'`。

- [ ] **Step 2: ChatView 消费 pending 并 `submitInput`**

在 `sendUserText` 旁增加（用 ref 避免 effect 闭包过期）：

```ts
  const sendNewsCard = async (payload: NewsCardPayload, sessionId: string) => {
    const prompt = NEWS_CARD_INTENT_PROMPTS[payload.intent]
    window.api.submitInput(prompt, sessionId, payload)
    markResponding(sessionId, true)
  }
  sendNewsCardRef.current = sendNewsCard
```

`useEffect`（挂载 + 事件）：

```ts
  useEffect(() => {
    const { consumePendingNewsCardSend } = /* from useChat — 从组件顶层解构，不要在 effect 里调用 useChat */
    const run = () => {
      const pending = consumePendingNewsCardSend()
      if (!pending) return
      void sendNewsCardRef.current(pending.payload, pending.sessionId)
    }
    run()
    window.addEventListener('fa-news-card-send', run)
    return () => window.removeEventListener('fa-news-card-send', run)
  }, [consumePendingNewsCardSend])
```

从 `useChat()` 解构 `consumePendingNewsCardSend`。`sendNewsCardRef` 与现有 `sendUserTextRef` 同样声明。

用户气泡仍只由 `onNewMessage` 添加，避免和 `submitInput` 回声重复。

- [ ] **Step 3: 手工核对**

- 从资讯流点一次后：先出现新标签（标题为新闻标题截断 40 字），再进入聊天并发出卡片。
- `ensureActiveSession` 失败时抛错给调用方，**此时尚未 navigate**——注意当前代码是先 `ensure` 再 `navigate`，符合 spec「留在资讯流」。
- 当前会话正在 streaming 时：`newSession()` 仍会执行（无条件），旧会话继续流式。

---

### Task 6: 资讯流右键菜单

**Files:**
- Create: `src/renderer/src/components/news/NewsFeedContextMenu.tsx`
- Modify: `src/renderer/src/components/news/NewsFeedTab.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: Task 1 菜单常量与 `buildNewsCardPayload`；Task 5 `requestNewsCardAnalysis`；`useAppDialog().alert`
- Produces: 列表项右键 / 键盘菜单键弹出应用内菜单

- [ ] **Step 1: 创建 `NewsFeedContextMenu.tsx`**

```tsx
import React, { useEffect } from 'react'
import { NEWS_CARD_FIXED_MENU, type NewsCardIntent } from '../../utils/chatPrefill'

export type NewsFeedMenuItem = { intent: NewsCardIntent; label: string }

interface NewsFeedContextMenuProps {
  x: number
  y: number
  items: NewsFeedMenuItem[]
  disabled: boolean
  onSelect: (intent: NewsCardIntent) => void
  onClose: () => void
}

const NewsFeedContextMenu: React.FC<NewsFeedContextMenuProps> = ({
  x,
  y,
  items,
  disabled,
  onSelect,
  onClose
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fa-news-ctx-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <ul
        className="fa-news-ctx-menu"
        style={{ top: y, left: x }}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <li key={item.intent} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              className="fa-news-ctx-item"
              onClick={() => {
                if (disabled) return
                onSelect(item.intent)
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default NewsFeedContextMenu
```

- [ ] **Step 2: `index.css` 追加菜单样式**

```css
  .fa-news-ctx-backdrop {
    @apply fixed inset-0 z-50;
  }

  .fa-news-ctx-menu {
    @apply absolute z-50 min-w-[12rem] overflow-hidden rounded-xl border py-1 shadow-lg;
    border-color: var(--fa-border);
    background: var(--fa-surface);
  }

  .fa-news-ctx-item {
    @apply block w-full cursor-pointer px-3 py-2 text-left text-sm text-[var(--fa-text)] transition-colors duration-150;
  }

  .fa-news-ctx-item:hover:not(:disabled) {
    background: var(--fa-surface-hover);
  }

  .fa-news-ctx-item:disabled {
    @apply cursor-not-allowed opacity-40;
  }
```

菜单定位：打开前把 `x/y` clamp 到视口内（`Math.min(x, window.innerWidth - 200)` 等），避免贴边裁切。

- [ ] **Step 3: `NewsFeedTab.tsx` 接入**

从 `useChat()` 取 `requestNewsCardAnalysis`。`NewsView` 在 `ChatProvider` 内（确认 `App.tsx` 已包住路由；若新闻页不在 Provider 内则把菜单调用改到有 Provider 的父级——当前 `App.tsx` 的 `ChatProvider` 包住全部 Route，可用）。

状态：

```ts
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    item: NotifiedNewsItem
  } | null>(null)
```

列表滚动容器 `onScroll`：`setCtxMenu(null)`。

条目 `div`：

```tsx
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtxMenu({ x: e.clientX, y: e.clientY, item })
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void handleOpenItem(item)
                      }
                      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                        e.preventDefault()
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                        setCtxMenu({ x: rect.left + 12, y: rect.top + 12, item })
                      }
                    }}
```

**不要**改 `onClick` / `handleOpenItem`。

菜单 items：

```ts
  const menuItems = ctxMenu
    ? [
        ...NEWS_CARD_FIXED_MENU,
        ...(shouldShowRelatedStocksMenu(ctxMenu.item, holdings)
          ? [{ intent: 'related_stocks' as const, label: '分析相关个股' }]
          : [])
      ]
    : []
```

`onSelect`：

```ts
  const handleAnalyzeIntent = async (intent: NewsCardIntent) => {
    if (!ctxMenu) return
    const payload = buildNewsCardPayload(intent, ctxMenu.item, holdings)
    setCtxMenu(null)
    if (!payload) return
    try {
      await requestNewsCardAnalysis(payload)
    } catch (e) {
      await alert({
        title: '发送失败',
        message: e instanceof Error ? e.message : '新建对话失败，请稍后重试'
      })
    }
  }
```

无标题时 `disabled={!(ctxMenu.item.title || '').trim()}`。

- [ ] **Step 4: 按 spec §7 交给用户手工验收（实现者不要编译、不要写测试）**

清单与 spec 第 7 节相同：三项+条件第四项、左键不变、新对话卡片、streaming 不打断、外链、无持仓、刷新卡片仍在、Toast/个股/组合不变。

---

## Spec coverage（自检）

| Spec | Task |
|------|------|
| 只分析动作 / 单条 / 强制新会话 | 5, 6 |
| 固定 3 项 + 相关个股出现条件 | 1, 6 |
| 用户气泡是卡片不是长文 | 4 |
| LLM 短意图+附件 / 标题用新闻标题 | 2 |
| IPC news_card，不污染 prefill | 3, 5 |
| 新建会话失败留在资讯流 | 5, 6 |
| Toast / requestPrefill 不变 | 5（不改函数体） |
| 无新 Agent 工具 | 2 |
| 键盘菜单键 / Esc / 滚动关闭 | 6 |
| 左键打开原文不变 | 6 |

无 TBD。类型名全程 `NewsCardPayload` / `NewsCardIntent` / `news_card` 块。
