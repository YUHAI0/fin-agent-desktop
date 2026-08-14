# Fin-Agent Desktop 1.0.2 更新说明

**版本号：** 1.0.2  
**发布日期：** 2026-08-14  
**定位：** 现有能力打磨 — 提醒可读性、Agent 按需查新闻、本地模型配置体验。

---

## 本版本亮点

- 股价提醒全渠道语义化文案，始终带股票名称
- 百分比提醒持久化元数据，触发文案可表达「较设置时上涨 X%」
- 新增 Agent 工具 `query_news`，按需从 akshare 实时拉取全量快讯
- 设置页完整支持 Ollama / LM Studio / 自定义本地模型，可自动拉取模型列表
- 本地模型工具调用失败时友好降级提示

---

## 详细更新

### 提醒系统

- 新增 `alert_copy.py` 集中生成提醒文案，覆盖 Toast、邮件、提醒列表、触发历史、Agent 工具返回
- 文案前缀统一为 `{股票名称}({代码})`，条件摘要使用 `condition_label`（如「突破 20.50 元」「较设置时上涨 5%」）
- 百分比提醒创建时持久化 `base_price`、`pct`、`direction` 元数据
- `alert_history.json` 新增 `message`、`condition_label` 字段；旧记录前端 fallback 兼容
- 提醒管理页条件列优先展示 `condition_label`，历史页优先展示完整 `message`

### 新闻与 Agent 工具

- 新增 Agent 工具 **`query_news`**：实时从 akshare 拉取全量快讯（财联社、东财全球、个股新闻等）
- 支持筛选维度：内容关键词、板块（关键词 + 东财概念/行业成分股关联）、指定股票、相对/绝对时间、数量上限
- 新增 `news_query.py` 查询服务；现有 `query_notified_news`（本地已推送新闻）行为不变

### 本地模型

- 设置页新增三个本地子预设：**Ollama**、**LM Studio**、**自定义本地**（均映射后端 `provider=local`）
- 自动拉取已安装模型列表（Ollama `/api/tags`；LM Studio `/v1/models`）；支持下拉选择 + 手动输入
- API Key 可选（Ollama 默认 `ollama`）；`.env` 持久化 `LOCAL_BACKEND` 便于 UI 还原子预设
- 新增 `GET /config/local-models` 端点；设置页展示工具调用能力建议（推荐 Qwen2.5、Llama 3.1+ 等）
- 本地模型 LLM / 工具调用失败时，Agent 追加友好提示，建议换模型或改用云端 API

---

## 升级说明

1. 安装包版本号为 **1.0.2**（如 `Fin-Agent-1.0.2-x64.exe`）
2. 建议**完全退出并重启**应用，以便 Python sidecar 加载新 API 与 Agent 工具
3. 既有配置、组合、提醒任务会保留；旧提醒历史无 `message` 字段时仍可正常查看

---

## 本版本明确不做

以下能力规划在后续版本，不在 1.0.2 范围：

| 能力 | 计划版本 |
|------|----------|
| 新闻结果写入本地库 / 资讯流 UI 展示 | 后续版本 |
| 板块关联走 Tushare 替代 akshare | 后续版本 |
| 本地模型能力自动探测 / 标注 | 后续版本 |
| 投资仪表盘、Watchlist、定时简报 | v1.1 / v1.2 |

完整路线图见项目根目录 `ROADMAP.md`。
