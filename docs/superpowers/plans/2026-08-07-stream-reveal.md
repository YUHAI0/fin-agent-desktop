# Stream Reveal（流式匀速漏字）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端对助手 `content`/`thinking` 做固定约 24 字/秒的匀速漏字展示，工具事件即时插队，停止时 flush，接近 ChatGPT/Cursor 的可读流式体验。

**Architecture:** 新建会话级 `StreamRevealController`：网络仍全速收 `bot-stream`，文本入队后由 `requestAnimationFrame` 泵按码点速率回调 `onReveal`；`ChatView` 把可见 `blocks` 更新交给该泵，工具/错误仍走原即时路径。

**Tech Stack:** Electron renderer、React 18、TypeScript、现有 `ChatView` + `bot-stream` IPC（不改主进程/Python）。

**Spec:** `docs/superpowers/specs/2026-08-07-stream-reveal-design.md`

## Global Constraints

- 仅改 renderer；不改 Python、`bot-stream` 协议、主进程转发
- `CHARS_PER_SECOND = 24`；单帧最多漏 6 个码点；不做设置页速度档
- 半成品 Markdown 照常 `ReactMarkdown` 渲染
- 不生成 Mock 代码；不编译整个项目（不要跑 `npm run build` / `electron-vite build`）
- 本仓库无单元测试框架：纯逻辑用内联自检脚本验证；UI 用手测清单验收
- 提交只包含本功能相关文件

## File Map

| 文件 | 职责 |
|------|------|
| `src/renderer/src/utils/streamReveal.ts` | 会话队列、rAF 泵、flush、结束标记、reduced-motion 短路 |
| `src/renderer/src/utils/streamReveal.selfcheck.ts` | 无框架自检：验证切片速率累计与 flush |
| `src/renderer/src/components/ChatView.tsx` | 文本事件改入队；工具即时；停止 flush；光标 UI |
| `src/renderer/src/index.css` | `.fa-stream-caret` 闪烁；`prefers-reduced-motion` 关闭动画 |

---

### Task 1: StreamRevealController 纯逻辑

**Files:**
- Create: `src/renderer/src/utils/streamReveal.ts`
- Create: `src/renderer/src/utils/streamReveal.selfcheck.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `CHARS_PER_SECOND = 24`
  - `MAX_CHARS_PER_FRAME = 6`
  - `type RevealKind = 'text' | 'thinking'`
  - `type RevealHandlers = { onReveal: (sessionKey: string, kind: RevealKind, chunk: string) => void; onSettled?: (sessionKey: string) => void }`
  - `class StreamRevealController` 方法：
    - `enqueue(sessionKey: string, kind: RevealKind, text: string): void`
    - `markEnded(sessionKey: string): void`
    - `flush(sessionKey: string): void`
    - `isRevealing(sessionKey: string): boolean`
    - `dispose(sessionKey: string): void`
    - `disposeAll(): void`
  - 辅助（可导出供自检）：`takeCodePoints(s: string, n: number): { taken: string; rest: string }`
  - `prefersReducedMotion(): boolean`（读 `matchMedia`，无 window 时返回 false）

- [ ] **Step 1: 实现 `streamReveal.ts`（完整）**

```typescript
export const CHARS_PER_SECOND = 24
export const MAX_CHARS_PER_FRAME = 6

export type RevealKind = 'text' | 'thinking'

export type RevealHandlers = {
  onReveal: (sessionKey: string, kind: RevealKind, chunk: string) => void
  /** 队列空且已 markEnded 时调用一次 */
  onSettled?: (sessionKey: string) => void
}

type QueueItem = { kind: RevealKind; text: string }

type SessionState = {
  queue: QueueItem[]
  ended: boolean
  settled: boolean
  rafId: number | null
  lastTs: number | null
  carryMs: number
}

export function takeCodePoints(s: string, n: number): { taken: string; rest: string } {
  if (n <= 0 || !s) return { taken: '', rest: s }
  const chars = Array.from(s)
  if (n >= chars.length) return { taken: s, rest: '' }
  return { taken: chars.slice(0, n).join(''), rest: chars.slice(n).join('') }
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  } catch {
    return false
  }
}

export class StreamRevealController {
  private sessions = new Map<string, SessionState>()
  private handlers: RevealHandlers

  constructor(handlers: RevealHandlers) {
    this.handlers = handlers
  }

  private ensure(sessionKey: string): SessionState {
    let s = this.sessions.get(sessionKey)
    if (!s) {
      s = { queue: [], ended: false, settled: false, rafId: null, lastTs: null, carryMs: 0 }
      this.sessions.set(sessionKey, s)
    }
    return s
  }

  enqueue(sessionKey: string, kind: RevealKind, text: string): void {
    if (!text) return
    if (prefersReducedMotion()) {
      this.handlers.onReveal(sessionKey, kind, text)
      return
    }
    const s = this.ensure(sessionKey)
    s.settled = false
    const last = s.queue[s.queue.length - 1]
    if (last && last.kind === kind) {
      last.text += text
    } else {
      s.queue.push({ kind, text })
    }
    this.kick(sessionKey)
  }

  markEnded(sessionKey: string): void {
    const s = this.ensure(sessionKey)
    s.ended = true
    if (prefersReducedMotion() || s.queue.length === 0) {
      this.settle(sessionKey)
      return
    }
    this.kick(sessionKey)
  }

  flush(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s) return
    this.cancelRaf(s)
    while (s.queue.length) {
      const item = s.queue.shift()!
      if (item.text) this.handlers.onReveal(sessionKey, item.kind, item.text)
    }
    s.ended = true
    this.settle(sessionKey)
  }

  isRevealing(sessionKey: string): boolean {
    const s = this.sessions.get(sessionKey)
    if (!s) return false
    return s.queue.length > 0 || (s.rafId != null && !s.settled)
  }

  dispose(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s) return
    this.cancelRaf(s)
    this.sessions.delete(sessionKey)
  }

  disposeAll(): void {
    for (const key of [...this.sessions.keys()]) this.dispose(key)
  }

  private settle(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s || s.settled) return
    if (s.queue.length > 0) return
    s.settled = true
    this.cancelRaf(s)
    this.handlers.onSettled?.(sessionKey)
  }

  private cancelRaf(s: SessionState): void {
    if (s.rafId != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(s.rafId)
    }
    s.rafId = null
    s.lastTs = null
  }

  private kick(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s || s.rafId != null) return
    if (typeof requestAnimationFrame === 'undefined') {
      // 无 rAF 环境：同步漏光（自检用）
      this.flush(sessionKey)
      return
    }
    const tick = (ts: number) => {
      const st = this.sessions.get(sessionKey)
      if (!st) return
      st.rafId = null
      if (st.lastTs == null) st.lastTs = ts
      const dt = ts - st.lastTs
      st.lastTs = ts
      st.carryMs += dt

      const msPerChar = 1000 / CHARS_PER_SECOND
      let budget = Math.floor(st.carryMs / msPerChar)
      if (budget <= 0) {
        if (st.queue.length > 0 || !st.ended) {
          st.rafId = requestAnimationFrame(tick)
        } else {
          this.settle(sessionKey)
        }
        return
      }
      st.carryMs -= budget * msPerChar
      budget = Math.min(budget, MAX_CHARS_PER_FRAME)

      while (budget > 0 && st.queue.length > 0) {
        const head = st.queue[0]
        const { taken, rest } = takeCodePoints(head.text, budget)
        if (!taken) break
        budget -= Array.from(taken).length
        head.text = rest
        if (!head.text) st.queue.shift()
        this.handlers.onReveal(sessionKey, head.kind, taken)
      }

      if (st.queue.length > 0 || !st.ended) {
        st.rafId = requestAnimationFrame(tick)
      } else {
        this.settle(sessionKey)
      }
    }
    s.rafId = requestAnimationFrame(tick)
  }
}
```

- [ ] **Step 2: 写自检脚本**

创建 `src/renderer/src/utils/streamReveal.selfcheck.ts`：

```typescript
import { takeCodePoints, CHARS_PER_SECOND, MAX_CHARS_PER_FRAME } from './streamReveal'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const a = takeCodePoints('你好世界', 2)
assert(a.taken === '你好' && a.rest === '世界', 'takeCodePoints CJK')

const b = takeCodePoints('hi👍!', 3)
assert(Array.from(b.taken).length === 3 && b.rest === '!', 'takeCodePoints emoji')

assert(CHARS_PER_SECOND === 24, 'rate')
assert(MAX_CHARS_PER_FRAME === 6, 'frame cap')

console.log('streamReveal.selfcheck: OK')
```

- [ ] **Step 3: 跑自检**

在 `fin-agent-desktop` 根目录（若无 `tsx`，用临时方式：把 `takeCodePoints` 逻辑复制到 node 一次性脚本亦可；优先）：

```bash
npx --yes tsx src/renderer/src/utils/streamReveal.selfcheck.ts
```

Expected: 打印 `streamReveal.selfcheck: OK`，exit 0。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/utils/streamReveal.ts src/renderer/src/utils/streamReveal.selfcheck.ts
git commit -m "feat: add StreamRevealController for paced text reveal"
```

---

### Task 2: ChatView 接入缓冲泵

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx`

**Interfaces:**
- Consumes: `StreamRevealController`, `RevealKind`, `prefersReducedMotion` from `../utils/streamReveal`
- Produces: 文本流式经泵更新；工具路径不变

- [ ] **Step 1: 在 ChatView 内增加 reveal 辅助（挂载时创建 controller）**

在组件内用 `useRef` 持有 controller，并实现把 `onReveal` 写回会话消息的函数（与现有 `applyToSession` / `updateSessionMessages` 一致）。会话 key：`eventSessionId ?? activeSessionIdRef.current ?? '__default__'`。

`onReveal` 逻辑（等价于原 `content`/`thinking` 分支，但 `chunk` 来自泵）：

```typescript
const appendRevealed = (sessionKey: string, kind: RevealKind, chunk: string) => {
  const sessionId = sessionKey === '__default__' ? undefined : sessionKey
  applyToSession(sessionId, (prev) => {
    const newMessages = [...prev]
    // 确保末尾是 assistant（与现有 patchFromStream 相同）
    if (!newMessages.length || newMessages[newMessages.length - 1].role !== 'assistant') {
      newMessages.push({ role: 'assistant', content: '', logs: '', blocks: [] })
    }
    const ai = newMessages.length - 1
    const src = newMessages[ai]
    newMessages[ai] = { ...src, blocks: (src.blocks || []).map((b) => ({ ...b })) }
    const assistantMsg = newMessages[ai]
    if (!assistantMsg.blocks) assistantMsg.blocks = []

    if (kind === 'text') {
      assistantMsg.content = (assistantMsg.content || '') + chunk
      const last = assistantMsg.blocks[assistantMsg.blocks.length - 1]
      if (last && last.type === 'text') {
        assistantMsg.blocks[assistantMsg.blocks.length - 1] = {
          ...last,
          content: last.content + chunk
        }
      } else {
        assistantMsg.blocks.push({ type: 'text', content: chunk })
      }
    } else {
      const last = assistantMsg.blocks[assistantMsg.blocks.length - 1]
      if (last && last.type === 'thinking') {
        assistantMsg.blocks[assistantMsg.blocks.length - 1] = {
          ...last,
          content: last.content + chunk
        }
      } else {
        assistantMsg.blocks.push({ type: 'thinking', content: chunk })
      }
    }
    return newMessages
  })
}
```

用 `useRef` + `useEffect` 创建：

```typescript
const revealRef = useRef<StreamRevealController | null>(null)
const [revealingKeys, setRevealingKeys] = useState<Set<string>>(() => new Set())

useEffect(() => {
  const ctrl = new StreamRevealController({
    onReveal: (sessionKey, kind, chunk) => {
      appendRevealedRef.current(sessionKey, kind, chunk)
      setRevealingKeys((prev) => {
        const next = new Set(prev)
        next.add(sessionKey)
        return next
      })
    },
    onSettled: (sessionKey) => {
      setRevealingKeys((prev) => {
        const next = new Set(prev)
        next.delete(sessionKey)
        return next
      })
    }
  })
  revealRef.current = ctrl
  return () => ctrl.disposeAll()
}, [])
```

注意：`appendRevealed` 需放进 `appendRevealedRef`，避免闭包过期；`applyToSession` 同理用 ref 包一层（与现有 `activeSessionIdRef` 模式一致）。

- [ ] **Step 2: 改 `onBotStream` 中 content / thinking / finish / answer**

1. **`content`**：不要直接 `assistantMsg.content += ...`。改为：

```typescript
if (data.type === 'content') {
  // 仍确保 assistant 气泡已创建（可先走一遍「若无 assistant 则 push」的公共前置，但不写字）
  const key = eventSessionId || activeSessionIdRef.current || '__default__'
  revealRef.current?.enqueue(key, 'text', data.content || '')
  return newMessages // 若前置只创建了空 assistant，返回；否则若本分支前已 clone，注意不要重复写字
}
```

实现时建议重构 `patchFromStream`：对 `content`/`thinking` 在进入大 patch 前单独处理——先 `ensureAssistant`（若需要）再 `enqueue`，**跳过**原追加逻辑。

2. **`thinking`**：同样 `enqueue(key, 'thinking', data.content || '')`。

3. **`finish` / `error`**：在现有 `markResponding(false)` 之外调用 `revealRef.current?.markEnded(key)`；`error` 的可见错误文本仍即时写入（保持现有 error 分支）。

4. **`answer`**：保留「若可见 content 仍空则补字」语义，但改为 `enqueue(key, 'text', data.content || '')`（仅当需要补空时），避免与已漏出内容重复。判定改为：若该会话泵队列空且 assistant 可见 text 仍空，再 enqueue；若泵还在漏，则只 `markEnded`，由泵漏完即可。更稳妥实现：

```typescript
} else if (data.type === 'answer') {
  const key = eventSessionId || activeSessionIdRef.current || '__default__'
  revealRef.current?.markEnded(key)
  // 仅当尚未有任何 text block 且 content 为空时，把 answer 入队（兼容只推 answer 的供应商）
  const hasText =
    (assistantMsg.content && assistantMsg.content.trim()) ||
    assistantMsg.blocks?.some((b) => b.type === 'text' && b.content)
  if (!hasText && data.content) {
    revealRef.current?.enqueue(key, 'text', data.content)
  }
}
```

5. **工具类事件**：保持现有即时写入逻辑不变。

- [ ] **Step 3: 停止时 flush**

在 `handleSubmit` 里 `isResponding` 分支：

```typescript
if (isResponding) {
  const key = activeSessionId ?? '__default__'
  revealRef.current?.flush(key)
  window.api.stopGeneration(activeSessionId ?? undefined)
  markResponding(activeSessionId ?? undefined, false)
  setIsTyping(false)
  return
}
```

- [ ] **Step 4: 光标 UI**

渲染 assistant 的最后一个 `text` block 时，若当前消息所属会话正在 reveal（`revealingKeys` 含该 session key）且该 block 是该消息最后一个 text block，在 Markdown 容器后加：

```tsx
{showCaret && <span className="fa-stream-caret" aria-hidden />}
```

`showCaret`：`msg.role === 'assistant' && revealingKeys.has(sessionKeyForActiveOrMsg)`——活动会话用 `activeSessionId ?? '__default__'`；历史已完成消息不加。

- [ ] **Step 5: 手测（开发态 `npm run dev`，不 build）**

1. 发长问题：字匀速出现，约 24 字/秒  
2. 触发表格：半成品 Markdown 边出边渲  
3. 触发工具：工具卡即时出现  
4. 输出中点停止：剩余字立刻出完，光标消失  
5. 开两个会话交错提问：互不抢字  

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChatView.tsx
git commit -m "feat: pace assistant stream text via StreamRevealController"
```

---

### Task 3: 光标样式

**Files:**
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: `.fa-stream-caret` class from ChatView
- Produces: 闪烁光标；reduced-motion 下静态或不显示动画

- [ ] **Step 1: 追加 CSS**

在 `index.css` 动画区附近加入：

```css
.fa-stream-caret {
  display: inline-block;
  width: 0.55ch;
  margin-left: 1px;
  border-radius: 1px;
  background: var(--fa-accent);
  color: transparent;
  animation: fa-caret-blink 1s steps(1, end) infinite;
  vertical-align: text-bottom;
  height: 1.1em;
}

@keyframes fa-caret-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .fa-stream-caret {
    animation: none;
    opacity: 0;
  }
}
```

- [ ] **Step 2: 确认手测光标**

输出中可见光标；结束后消失；系统减少动态效果时不闪烁。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "style: add stream reveal caret for typing indicator"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 24 字/秒固定速率 + 单帧上限 | Task 1 |
| content/thinking 入队漏字 | Task 2 |
| Markdown 照常渲 | Task 2（不改渲染路径） |
| 工具即时插队 | Task 2 |
| finish/answer 结束与对齐 | Task 2 |
| 停止 flush | Task 2 |
| 会话隔离 | Task 1 Map + Task 2 sessionKey |
| prefers-reduced-motion | Task 1 enqueue 短路 + Task 3 |
| 光标 | Task 2 + Task 3 |
| 不改 Python/主进程 | 全局约束 |

## Placeholder / 一致性自检

- 无 TBD；API 名全程 `enqueue` / `markEnded` / `flush` / `onSettled` 一致  
- `RevealKind` 仅 `'text' | 'thinking'`  
- 未引入 Mock；未要求全量编译  

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-stream-reveal.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务派生子代理，任务间复查  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

Which approach?
