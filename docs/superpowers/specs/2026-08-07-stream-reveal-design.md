# 流式文字平滑输出（Stream Reveal）设计

日期：2026-08-07  
项目：fin-agent-desktop  
状态：已定稿待实现

## 1. 背景与问题

当前聊天回复由 LLM 流式 chunk 直推到 renderer：每收到 `content` / `thinking` 就立刻拼进消息并重渲 Markdown。结果是：

- **太快**：字速跟模型一致，阅读跟不上
- **不平滑**：高频 `setState` + 整段 `ReactMarkdown` 重解析，易抖、易跳
- **难读**：视觉上像「整块喷字」，缺少匀速打字感

用户目标：接近 ChatGPT / Cursor 的匀速、稳定、可读体验；半成品 Markdown 仍边出边渲。

## 2. 目标与非目标

### 目标

1. 助手可见文字以**固定偏慢**速率匀速出现（约 24 Unicode 码点/秒）
2. 流式过程中 Markdown **照常渲染**（允许短暂半成品表格/列表）
3. 工具相关 UI **即时**出现，不被打字机拖住
4. 多会话并行互不抢字；停止时立刻 flush 剩余缓冲
5. 尊重 `prefers-reduced-motion`：开启则跳过打字机，即时展示

### 非目标（本轮不做）

- 设置页速度档位（快/标准/慢）
- 后端 / Python 侧节流
- 半成品 Markdown 延迟成型或「先纯文本后排版」
- 修改 `bot-stream` 协议或主进程转发逻辑

## 3. 方案选择

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 前端展示缓冲（打字机） | 全速收流，UI 按固定速率漏字 | **采用** |
| B. 后端 sleep 节流 | 拖慢整条链路与工具回合 | 不采用 |
| C. 仅 rAF 合批、不控字速 | 减卡顿但不解决「太快」 | 不采用（合批仅作 A 的配套） |

## 4. 架构与数据流

```
LLM chunk → Main → bot-stream
                      ↓
              ChatView 收事件
                      ↓
         ┌────────────┴────────────┐
         │ content / thinking      │ → 写入会话级「展示缓冲队列」
         │ tool_* / error / finish │ → 立即写入消息状态（插队）
         └────────────┬────────────┘
                      ↓
              rAF 打字机泵（固定速率）
                      ↓
              追加到可见 text / thinking block
                      ↓
              ReactMarkdown 照常渲染
```

原则：**后端仍全速推流；只减速看得见的字。不改 Python `stream_chat` / LLM 客户端。**

## 5. 行为细则

### 5.1 速率

- 常量：`CHARS_PER_SECOND = 24`（按 Unicode 码点计，中英均算 1）
- 驱动：`requestAnimationFrame`
- 每帧应漏字数：`floor(elapsedMs / 1000 * CHARS_PER_SECOND)`，并用累计误差避免长期偏慢
- 单帧上限：例如最多 6 码点，防止掉帧后一次喷出大段

### 5.2 缓冲与可见内容

- `content` / `thinking`：入队，**不**直接拼进可见 `blocks`
- 泵从队头取字符，追加到当前会话 assistant 消息对应的 `text` / `thinking` block（及兼容字段 `content`）
- 队列空且流未结束：停泵等待；队列空且已收到结束信号：停泵，去掉输出光标
- 流结束后：缓冲漏完后与本轮最终文本做一次对齐，防止丢字

### 5.3 插队（立即生效，不进打字机）

- `tool_call` / `tool_call_chunk` / `tool_result`
- `error`
- `finish`：标记该会话流结束；可见字仍以缓冲漏完为准
- `answer`：作完成/对齐信号，不替代打字机漏字过程

### 5.4 中断

用户点击停止：清空该会话排队逻辑的同时 **flush 剩余缓冲到可见内容**，立刻去掉光标，避免「停了还空着」。

### 5.5 会话隔离

每个 `sessionId` 独立队列与 rAF 泵；切换会话不影响其他会话的漏字进度。

### 5.6 可访问性

若 `window.matchMedia('(prefers-reduced-motion: reduce)').matches`：`content` / `thinking` 直接写入可见状态，不经过打字机。

### 5.7 视觉

正在漏字的 text block 末尾显示轻量闪烁光标（CSS）；结束或 flush 后移除。

## 6. 实现范围

| 路径 | 变更 |
|------|------|
| `src/renderer/src/utils/streamReveal.ts`（新建） | 会话级入队、rAF 泵、flush、结束标记、reduced-motion 短路 |
| `src/renderer/src/components/ChatView.tsx` | 文本类事件改走缓冲；工具/错误仍即时；停止时 flush；光标 UI |
| `src/renderer/src/index.css` | 光标动画；`prefers-reduced-motion` 下关闭动画 |

## 7. 错误与边界

- 空 chunk：忽略
- 会话已删除 / 切走：泵可继续更新该 session 的持久消息（与现有 `updateSessionMessages` 行为一致），不因非活动会话停泵
- 历史消息加载：无缓冲，直接展示已存全文
- `get_current_time` 等隐藏工具：保持现有「执行但不渲染」逻辑，与打字机无关

## 8. 测试与验收

手动验收（本轮不强制自动化）：

1. 长回答匀速出现，约 24 字/秒，无明显整段跳动喷字
2. 流式中表格/列表 Markdown 照常渲染（允许短暂半成品）
3. 工具卡片即时出现，不被拖住
4. 停止：立刻出完已缓冲内容，光标消失
5. 多会话并行：互不抢字
6. 系统「减少动态效果」开启：跳过打字机，即时全文

## 9. 后续可选（不在本 spec）

- 设置页三档速度
- 对超大表格流式时的轻量降级（例如流式中用简化渲染）
