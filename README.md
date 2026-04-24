# Fin-Agent Desktop

![Intro](resources/intro.gif)

<div align="center">

[![Website](https://img.shields.io/badge/Website-fin--agent.chat-blue?style=flat-square)](https://www.fin-agent.chat/)
[![License](https://img.shields.io/github/license/YUHAI0/fin-agent-desktop.svg?style=flat-square)](https://github.com/YUHAI0/fin-agent-desktop/blob/main/LICENSE)
[![Repo Size](https://img.shields.io/github/repo-size/YUHAI0/fin-agent-desktop.svg?style=flat-square)](https://github.com/YUHAI0/fin-agent-desktop)
[![Last Commit](https://img.shields.io/github/last-commit/YUHAI0/fin-agent-desktop.svg?style=flat-square)](https://github.com/YUHAI0/fin-agent-desktop/commits/main)
[![Latest Release](https://img.shields.io/github/v/release/YUHAI0/fin-agent-desktop.svg?style=flat-square)](https://github.com/YUHAI0/fin-agent-desktop/releases)
[![Star this repo](https://img.shields.io/github/stars/YUHAI0/fin-agent-desktop?style=social&label=Star)](https://github.com/YUHAI0/fin-agent-desktop) 

</div>

Fin-Agent Desktop 是一款基于 Electron + Python 的智能金融助手桌面应用。它集成了强大的 LLM 能力和专业的金融数据分析工具，为您提供自然流畅的金融咨询与分析服务。

> 💡 **核心引擎**: 本项目基于 [Fin-Agent](https://github.com/YUHAI0/fin-agent) 核心构建。Fin-Agent 是一个基于 DeepSeek 等大模型和 Tushare 金融数据的智能金融分析代理，支持自然语言选股、策略回测、股价预警等功能。

## ✨ 核心功能

- **📈 实时行情**: 支持查询股票、指数、ETF、期货等多种金融产品的实时和历史行情数据。
- **🎯 智能选股**: 支持通过自然语言描述选股条件。**特别擅长长尾股票筛选**，帮助您发掘市场中低关注度但具备高成长潜力的隐形冠军。
- **🔔 股价预警**: 支持设置股价涨跌幅或目标价监控，触发后自动提醒。
- **💼 组合管理**: 提供投资组合管理功能，支持持仓分析、收益追踪。
- **🔙 策略回测**: 内置回测引擎，支持多种日线策略验证；`run_backtest` 成功时客户端可展示累计收益曲线。

### `run_backtest` 支持的策略（`strategy` 一览表）

与 Python 包 [fin-agent](https://github.com/YUHAI0/fin-agent) 内置引擎一致，下表为全部合法 `strategy` 字符串（共 23 种）：

| 序号 | `strategy` | 分类 | 说明 |
| ---: | :--- | :--- | :--- |
| 1 | `ma_cross` | 均线 | 双均线金叉买、死叉卖。`params`：`short_window`, `long_window` 等。 |
| 2 | `macd` | 指标 | DIF/DEA 金叉死叉。`fast_period`, `slow_period`, `signal_period`。 |
| 3 | `rsi` | 指标 | RSI 超卖/超买穿越。`window`, `lower`, `upper`。 |
| 4 | `kdj` | 指标 | K/D 金叉死叉。`k_period`, `d_period`, `j_period`。 |
| 5 | `boll_reversion` | 布林 | 下轨收回买、上穿中轨卖。`period`, `std_dev`。 |
| 6 | `boll_breakout` | 布林 | 突破上轨买、跌回中轨下卖。`period`, `std_dev`。 |
| 7 | `momentum_roc` | 动量 | N 日 ROC 过零。`roc_window`。 |
| 8 | `donchian_breakout` | 通道 | 唐奇安 N 日高/低。`channel_period`。 |
| 9 | `turtle` | 通道 | 海龟入场/出场周期，可选 ATR 止损。`entry_period`, `exit_period`, `atr_stop_mult`, `atr_period`。 |
| 10 | `adx_macd` | 复合 | ADX+DI 过滤 + MACD。`adx_period`, `min_adx` 及 MACD 参数。 |
| 11 | `triple_ma` | 均线 | 三均线。`short_window`, `mid_window`, `long_window`。 |
| 12 | `ema_sma_bias` | 均线 | EMA/SMA 与乖离。`ema_span`, `sma_window`, `bias_threshold`。 |
| 13 | `cci` | 震荡 | CCI 穿越阈值。`period`, `oversold`, `overbought`。 |
| 14 | `williams_r` | 震荡 | Williams %R。`period`, `oversold`, `overbought`。 |
| 15 | `stochastic` | 震荡 | 随机 %K/%D。`k_period`, `d_period` 等。 |
| 16 | `rsi_ma200` | 复合 | RSI + 长期均线。`ma_window`, `window`, `lower`, `upper`。 |
| 17 | `volume_breakout` | 量价 | 放量突破。`breakout_period`, `vol_ma_period`, `volume_mult`, `exit_period`。 |
| 18 | `obv_cross` | 量价 | OBV 均线交叉。`obv_ma_period`。 |
| 19 | `vwap_deviation` | 量价 | VWAP 近似偏离。`period`, `deviation`。 |
| 20 | `ma_cross_atr_stop` | 风险 | 双均线 + ATR 止损。`atr_stop_mult`, `atr_period` 等。 |
| 21 | `vol_target_ma_cross` | 风险 | 双均线 + ATR 缩仓。`risk_budget_pct`, `max_fraction`, `atr_period`。 |
| 22 | `kelly_ma_cross` | 风险 | 双均线 + 固定仓位比例。`equity_fraction` 等。 |
| 23 | `cross_section_momentum` | 占位 | 多标的截面；单标的调用返回 **error**。 |

更完整的回测说明、假设与局限见子模块文档：`python/fin-agent/README.md` 中的 **「📈 策略回测」** 一节。

## 🆕 最近更新

- **图表与回测展示**：对日线类工具结果可内嵌 **K 线**（红涨绿跌）；`run_backtest` 成功返回时展示 **累计收益曲线**。时间轴为中文习惯日期；可关闭图表角标。
- **快捷回复**：助手可在回复末尾附带 **`FIN_AGENT_CHOICES_JSON`** 一行 JSON，客户端解析为可点击选项；无结构化内容时用规则与默认追问补足。固定提供 **「功能总览」** 按钮，向模型发起能力说明并要求其再给出示例问句 JSON。首次无本地聊天记录时自动插入 **欢迎消息**（含示例快捷句）。
- **聊天与排版**：助手区在宽屏下尽量 **横向铺满**；Markdown 表格与正文 **字号一致**；应用内使用 **细滚动条** 样式。
- **提醒任务**：右上角入口支持列表 **分页**、**按标的代码筛选**、删除时使用 **自定义确认**（非系统 `confirm`）。
- **稳定性**：多工具并行时流式参数与结果对齐；主进程 SSE 多行 `data` 逐条解析，避免工具结果丢失。
- **数据接口**：A 股日线 **`get_daily_price`** 增加可选参数 **`adj`**（`qfq`/前复权、`hfq`/后复权，省略为不复权）。

## 🚀 快速开始

前往 [Release](https://github.com/YUHAI0/fin-agent-desktop/releases) 页面下载最新版本的安装包。



## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=YUHAI0/fin-agent-desktop&type=date&legend=top-left)](https://www.star-history.com/#YUHAI0/fin-agent-desktop&type=date&legend=top-left)
