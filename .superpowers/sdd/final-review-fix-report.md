# Stream Reveal 最终评审修复

- 修复空队列且流未结束时持续调度 `requestAnimationFrame` 的问题；新数据到达后由 `enqueue()` 重新启动。
- `ChatView` 监听 `openTabs`，标签关闭后释放对应会话的 reveal 状态。
- 记录 `answer` 与 `isRevealing` 的去重约束，并接入 `selfcheck:stream-reveal` 脚本。
- 自检：`npx --yes tsx src/renderer/src/utils/streamReveal.selfcheck.ts`
- 结果：`streamReveal.selfcheck: OK`
