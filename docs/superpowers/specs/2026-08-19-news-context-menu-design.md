# 资讯流右键：新闻卡片送入对话

> 状态：待实现  
> 日期：2026-08-19  
> 相关：资讯流 `NewsFeedTab`、对话预填 `requestPrefill` / `chatPrefill.ts`、Toast 新闻分析

## 1. 目标

资讯流单条新闻支持右键，把该条以 **新闻卡片** 送进 **新对话** 做分析。用户气泡是卡片，不是粘贴的新闻正文。

约束（已确认）：

- 菜单只放分析动作，不含打开原文、复制、标记已读
- 只做单条；多选对比以后再说
- 始终新开对话并立刻发送，即使当前会话空闲也不写入旧会话
- 方案 B：固定 3 项 + 1 项按情况出现

## 2. 非目标

- 多选 / 批量分析
- 系统原生右键菜单
- 把 Toast「分析这条新闻对我持仓的影响」、个股体检、组合诊断改成卡片
- 新增 Agent 新闻工具；不要求模型再按 `news_id` 回查本地库
- 失败时回退成把正文粘进输入框
- 自动化测试与 Mock

## 3. 右键菜单

入口：资讯流列表项。应用内菜单（与现有下拉风格一致），不使用 OS 原生菜单。

左键不变：有 URL 则系统浏览器打开原文并标已读；无 URL 则只标已读。

### 3.1 固定项（顺序固定）

| 菜单文案 | 意图 id | 卡片标签 | 模型短意图 |
|---|---|---|---|
| 解读这条新闻 | `interpret` | 解读 | 请解读这条新闻 |
| 对我持仓的影响 | `portfolio_impact` | 持仓影响 | 请分析这条新闻对我当前持仓的影响 |
| 接下来可以做什么 | `next_actions` | 下一步 | 请根据这条新闻给出可执行的下一步 |

三项始终显示（有标题即可点）。无持仓时「对我持仓的影响」仍可点，模型须说明当前无持仓，并可改谈潜在相关标的。

### 3.2 按情况出现

**分析相关个股**（意图 id `related_stocks`，卡片标签「相关个股」，短意图「请分析这条新闻涉及的相关个股」）

仅当以下任一成立时显示：

1. `item.matched_symbols` 非空
2. `matchNewsToHoldings(标题+摘要, 当前持仓)` 返回非空（复用资讯流已有匹配）

相关代码列表 = `matched_symbols` 与持仓匹配结果的去重并集，随卡片快照带给模型。

### 3.3 交互细节

- 支持鼠标右键；支持键盘菜单键（焦点在该条上时）
- 点击菜单项后关闭菜单
- 点击空白、Esc、列表滚动时关闭菜单
- 当前会话正在流式回复时仍可点：强制新开，不打断旧会话

## 4. 对话中的用户消息：新闻卡片

用户消息 **不是** 一段「标题：…内容：…」长文。

### 4.1 界面

用户气泡渲染为卡片，字段：

- 意图标签（见上表）
- 标题
- 来源中文名、发布时间、利好/利空（有则显示）、原文 / 仅摘要
- 摘要最多两行（`line-clamp-2`）
- 相关代码（有则显示）
- 有规范化 URL 时，标题可点，系统浏览器打开；仅摘要则标题不可点外链

卡片外观对齐资讯流条目，但是对话气泡宽度，不复制整份列表筛选条。

### 4.2 存档结构

在现有 `Message` 上扩展 `blocks`，新增：

```ts
{
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

`Message.content` 仅作兼容：可存新闻标题，供会话列表/标题生成，**不作为气泡正文渲染**。只要存在 `news_card` 块，就只渲染卡片。

旧会话没有该块：仍按纯文本气泡显示。

快照随 `ui_messages` 持久化。本地新闻记录日后被清掉，已发出的卡片仍能回看。

### 4.3 发给模型的内容

两层分离：

- **UI / `ui_messages`**：只存卡片块
- **LLM `history` 的 user 消息**：短意图句 + 结构化附件（JSON 或等价紧凑键值），明确这是附件不是用户手打长文

附件字段与 `news` 快照一致。摘要随快照带上，**不新增** `query_notified_news` 按 id 查询。模型按现有分析结构回复（结论→依据→风险→下一步）；「下一步」意图应偏向查现价、设提醒、是否做个股体检等可执行项。

会话自动标题：用新闻标题截断，不用附件 JSON。

## 5. 架构与数据流

```text
NewsFeedTab 右键
  → NewsContextMenu 选意图
  → 组装 news_card 快照
  → ChatContext.requestNewsCardAnalysis(payload)
       1. newSession()（始终，不论当前是否 streaming）
       2. ensureActiveSession(seedTitle=新闻标题)
       3. 写入用户消息（news_card 块）
       4. navigate('/chat')
       5. 主进程 submit-input：{ message: 短意图, session_id, news_card }
  → POST /chat
  → FinAgent.stream_chat：user 内容 = 短意图 + 附件
  → ChatView 渲染卡片；助手流式回复如常
```

### 5.1 改动边界

| 位置 | 职责 |
|---|---|
| `NewsFeedTab` + 菜单小组件 | 右键、出现条件、调用分析入口 |
| `chatPrefill.ts` | 组装快照与短意图；**不**再为资讯流右键拼长文。`buildNewsImpactPrefill` 留给 Toast |
| `ChatContext` | `requestNewsCardAnalysis`：强制新会话后发送。`requestPrefill(text)` 行为不变 |
| `ChatView` | 渲染 `news_card` |
| 主进程 `submit-input` | 可选 `news_card` 原样转给 `/chat` |
| `api.py` `/chat` | 读取 `news_card`，交给 `stream_chat` |
| `agent/core.py` | 把附件编入 LLM user 消息；UI 存档仍由渲染层负责 |

不把卡片塞进现有 `requestPrefill` 的 `sessionStorage` 字符串通道，以免和纯文本预填互相污染。发送路径用结构化调用（例如 `requestNewsCardAnalysis` 内直接 `ensureActiveSession` + 写入 UI 消息 + IPC），不要复用 `fa-prefill-send` 的纯文本事件。

### 5.2 与现有预填的关系

| 入口 | 发送形态 | 会话 |
|---|---|---|
| 资讯流右键（本功能） | 新闻卡片 | 始终新建 |
| Toast 新闻分析 | 现有纯文本 `buildNewsImpactPrefill` | 现有 `requestPrefill`（仅在当前会话 streaming 时才新建） |
| 个股体检 / 组合诊断 | 现有纯文本 | 现有 `requestPrefill` |

## 6. 错误处理

- 无标题：对应菜单项不可点，不发空卡片
- `ensureActiveSession` 失败：留在资讯流，弹窗说明，**不**把卡片写入旧会话
- 配置未完成：沿用现有 `/config/check`，跳转设置页，不发消息
- 流式失败：新对话里已有卡片，助手侧走现有错误气泡；用户可在该会话重试
- 新建失败不得回退为往当前会话塞卡片或改发长文本

## 7. 验收（手工）

1. 右键出现固定三项；相关代码或持仓命中时才出现「分析相关个股」
2. 左键仍为打开原文 / 标已读
3. 点任一项：新开对话、用户气泡为卡片、意图标签正确、助手开始回复
4. 旧会话正在回复时再点，仍新开且不打断旧会话
5. 有链接的卡片标题打开系统浏览器；仅摘要不跳外链
6. 无持仓点「持仓影响」仍发出卡片，回复会说明无持仓
7. 离开再打开该会话，卡片仍在
8. 个股体检、组合诊断、Toast 新闻分析行为不变

## 8. 后续（不做本期）

- 多选新闻一起分析 / 对比
- Toast 改为同一套新闻卡片
- 卡片内再嵌快捷回复以外的二次操作
