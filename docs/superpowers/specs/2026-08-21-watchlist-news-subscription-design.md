# 新闻订阅：自选股类型

> 状态：已实现  
> 日期：2026-08-21  
> 范围：在现有新闻订阅上增加 `watchlist` 类型，动态跟随自选列表。不改 Watchlist CRUD、异动 Toast、研报夹。  
> 相关：`NewsSubscriptionDialog.tsx`、`news_store.py`、`news_monitor.py`、`news_tools.py`

## 1. 目标

新闻中心可创建「自选」订阅：自动跟随观察列表里的股票，命中相关快讯/个股新闻后按现有管道提醒。自选增删、改分组后，下一轮轮询生效。

## 2. 非目标

- 手填 `symbols`、按单只自选勾选
- 新建订阅类型拆成两条（候选 / 跟踪各一种 type）
- 改 Watchlist 存储、异动任务、组合页自选 Tab
- 云同步、自动测试、Mock

## 3. 已确认决策

- 新类型 `watchlist`，标签「自选」
- 一条订阅用 `groups` 勾选一组或两组：`candidate`（候选买入）、`track`（长期跟踪）
- 至少选一组；创建时默认两组都勾
- 不接受 `symbols`（与 `portfolio` 相同）
- 关键词选填：留空则所选分组里的个股新闻即提醒；填写则需同时命中关键词
- 排除词、来源、启停与现有订阅相同
- 来源默认三源（含 `stock_news_em`），与组合订阅一致
- 全局快讯用公司名匹配所选自选，规则与持仓订阅相同
- 自选为空：本轮无命中，不报错
- 类型创建后不可改；`groups` 可在编辑时改
- Agent：`create_news_subscription` 支持 `type=watchlist` 与可选 `groups`；省略 `groups` 则跟随两组

## 4. 界面

`NewsSubscriptionDialog` 四个类型 2×2：板块 / 主题 / 组合 / 自选。

选「自选」时：

- 说明：自动跟随所选分组的当前自选，增删或改分组后下一轮轮询生效
- 分组勾选：候选买入、长期跟踪；保存时至少一组
- 名称占位：例如「自选新闻」
- 关键词为可选过滤；来源提示与组合订阅同类（建议保留个股新闻）

订阅列表：自选条目展示「自动跟随自选：候选买入、长期跟踪」（按实际勾选）。资讯流类型筛选增加「自选」。

## 5. 数据

现有 `news_subscriptions.json` 条目新增可选字段：

```json
{
  "type": "watchlist",
  "groups": ["candidate", "track"]
}
```

- `watchlist` 不写 `symbols`
- `groups` 只允许 `candidate` / `track`，去重后按该顺序存储
- 缺失 `groups` 时匹配视为两组都跟（防御，正常创建总会写入）
- `portfolio` / `sector` / `topic` 禁止写入 `groups`

## 6. 匹配

每轮轮询从 `watchlist.json` 按订阅 `groups` 取当前 `ts_code`：

- 抓取 `stock_news_em` 时并入这些代码（与持仓代码合并去重）
- 命中条件与 `portfolio` 相同：必须匹配到至少一只所选分组内的股票；有关键词则还要命中关键词；排除词仍一票否决
- 发送通知前再过滤：若该股已不在所选分组（移除、改组、被持仓驱逐），不再弹出该订阅

## 7. API / Agent

- `POST /news/subscriptions/create` 接受 `groups`
- `POST /news/subscriptions/update` 允许改 `groups`（仅 `watchlist`）
- IPC 原样转发 payload，前端 `NewsSubscriptionInput` 增加 `groups?: WatchlistGroup[]`
- `create_news_subscription` / `update_news_subscription` 增加 `groups`；默认名「自选新闻」
