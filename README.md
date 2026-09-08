# Fin-Agent Desktop

用自然语言查行情、分析个股、管理持仓，让投资研究集中在一个桌面工作台。

[官网](https://www.fin-agent.chat/) · [下载安装](https://github.com/YUHAI0/fin-agent-desktop/releases) · [更新记录](docs/RELEASE-NOTES-1.1.1.md) · [路线图](ROADMAP.md) · [问题反馈](https://github.com/YUHAI0/fin-agent-desktop/issues)

![Fin-Agent Desktop 演示](resources/intro.gif)

Fin-Agent Desktop 是基于 Electron、React 和 Python 构建的金融分析助手，核心引擎来自 [Fin-Agent](https://github.com/YUHAI0/fin-agent)。它将模型对话、金融数据工具、投资组合、自选股和新闻订阅整合到桌面应用中，支持云端模型与本地模型接入。

## 可以做什么

| 场景 | 功能 |
| --- | --- |
| 行情与个股研究 | 按名称或代码搜索股票，查询行情和历史数据，在对话中查看日线 K 线。 |
| 自然语言分析 | 描述选股条件或提出分析问题，由 Agent 调用数据工具辅助研究。 |
| 投资仪表盘 | 在空会话首页查看组合总览、今日简报和已触发预警，快速发起个股分析或组合体检。 |
| 持仓与自选 | 管理投资组合，将观察标的放入「候选买入」或「长期跟踪」分组，跟踪价格异动。 |
| 价格预警 | 设置目标价或涨跌幅条件，配置轮询频率、交易时段限制及邮件通知。 |
| 新闻订阅 | 阅读财经新闻，订阅持仓或自选相关新闻，并从新闻继续发起分析。 |
| 分析报告 | 将个股体检、组合诊断等分析以结构化报告卡展示，收藏到研报夹，便于后续回看。 |
| 策略回测 | 调用内置日线策略回测，在成功返回结果时查看累计收益曲线。 |
| 个性化体验 | 通过首次启动向导填写投资画像，并在设置中调整模型、数据源和唤醒快捷键。 |

## 安装与首次使用

### 1. 下载应用

前往 [Releases](https://github.com/YUHAI0/fin-agent-desktop/releases) 下载适合自己系统的安装包，以发布页实际提供的文件为准。完整安装包包含 Python 后端，无需另行安装 Python 或 Node.js。

### 2. 配置模型

打开应用后，在配置页选择模型服务，填写对应的 API Key、接口地址和模型名称。

| 接入方式 | 配置说明 |
| --- | --- |
| DeepSeek | 填写 API Key；默认接口为 `https://api.deepseek.com`，默认模型为 `deepseek-chat`。 |
| OpenAI 兼容服务 | 填写服务商提供的 API Key、Base URL 和模型名称。 |
| Ollama | 先在本机启动服务并准备模型；默认接口为 `http://localhost:11434/v1`。 |
| LM Studio | 先加载模型并启动本地服务；默认接口为 `http://localhost:1234/v1`。 |
| 自定义本地服务 | 填写兼容接口地址和模型名称，按服务要求设置密钥。 |

本地模型的工具调用能力会影响行情查询、选股和回测等任务的执行效果。使用本地模型时，金融数据查询仍可能需要联网。

### 3. 选择数据源

- **AkShare**：默认数据源。
- **Tushare**：切换后填写自己的 Token；可用数据取决于账号的接口权限。

完成投资画像后，可以先添加持仓或自选股，再从首页场景入口开始研究。

### 4. 开始提问

下面是一些提问示例，实际结果取决于模型能力、数据源和可用数据：

- 「查询贵州茅台最近一个月的日线行情。」
- 「分析这只股票的基本面，并列出需要继续核实的风险。」
- 「帮我检查当前组合的行业集中度。」
- 「把这只股票加入长期跟踪自选。」
- 「用双均线策略回测 600519.SH 在 2024 年的表现。」

## 策略回测

回测通过核心引擎的 `run_backtest` 工具执行，支持双均线、MACD、RSI、KDJ、布林带、唐奇安通道、海龟策略，以及部分量价和仓位管理策略。客户端会根据成功返回的回测数据展示累计收益曲线。

完整策略标识、参数、回测假设和局限见 [核心引擎 README](python/fin-agent/README.md)。其中 `cross_section_momentum` 是多标的截面策略占位，单标的调用会返回错误，不应视为已可用的单标的策略。

## 本地开发

### 环境准备

准备 Node.js 与 npm（需满足仓库中 Vite 5 的运行要求），以及可安装 [Python 依赖](python/fin-agent/requirements.txt) 的 Python 环境。下面以 Windows PowerShell 为例，使用 Python 3.11 创建虚拟环境。

```powershell
git clone https://github.com/YUHAI0/fin-agent-desktop.git
cd fin-agent-desktop

npm ci
py -3.11 -m venv build_venv
.\build_venv\Scripts\python.exe -m pip install -r python/fin-agent/requirements.txt

npm run dev
```

macOS / Linux 可将虚拟环境创建和依赖安装命令替换为：

```bash
python3 -m venv build_venv
./build_venv/bin/python -m pip install -r python/fin-agent/requirements.txt
npm run dev
```

开发模式下，Electron 会自动启动 `python/api.py`，优先使用 `build_venv` 中的解释器，找不到时回退到系统 `python`。后端监听 `127.0.0.1:5678`，通常不需要另开终端手动启动。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动桌面开发环境。 |
| `npm run typecheck` | 检查主进程与前端 TypeScript 类型。 |
| `npm run build` | 执行类型检查并构建 Electron 和前端代码。 |
| `npm start` | 预览已构建的应用。 |
| `npm run lint` | 执行 ESLint，并自动修复可修复的问题。 |
| `npm run format` | 使用 Prettier 格式化项目。 |

### 构建安装包

使用 `make.py` 完成 Python 后端打包与 Electron 安装包构建：

```powershell
# Windows
.\build_venv\Scripts\python.exe make.py --target win
```

```bash
# macOS
./build_venv/bin/python make.py --target mac

# Linux
./build_venv/bin/python make.py --target linux
```

构建脚本会同步 `VERSION` 到 `package.json`，清理旧的 `dist/`、`out/` 和 `resources/python/`，通过 PyInstaller 生成后端，再调用 electron-builder。安装包输出到 `dist/`。

请在目标操作系统上构建：Python 后端由 PyInstaller 生成，不能通过切换 `--target` 跨系统生成可用后端。macOS 构建还需准备配置中引用的 `resources/icon.icns`。

`npm run build:win`、`npm run build:mac` 和 `npm run build:linux` 只负责 Electron 构建与打包，使用前必须已准备好 `resources/python/` 中对应平台的后端产物。

注意：构建脚本会将 `python/.env`（如果存在）复制到安装包后端目录。发布前请确保该文件不含个人密钥。

## 项目结构

```text
fin-agent-desktop/
├── src/
│   ├── main/                # Electron 主进程、窗口、后端进程和系统集成
│   ├── preload/             # 主进程与渲染进程之间的桥接接口
│   └── renderer/src/        # React 页面、组件、状态与图表展示
├── python/
│   ├── api.py               # 本地 HTTP API 与 Agent 调用入口
│   └── fin-agent/           # 金融分析核心、数据工具和本地存储
├── resources/               # 图标、演示图和打包资源
├── docs/                    # 版本说明与设计文档
├── electron-builder.json    # 各平台打包配置
├── make.py                  # Python + Electron 完整构建脚本
└── VERSION                  # 打包版本号
```

界面通过预加载接口与 Electron 主进程通信，再由主进程请求本机 Python 服务；Python 后端负责调用模型、金融数据源和本地存储。

## 配置与数据

Python 核心的配置及业务数据目录：

| 系统 | 默认位置 |
| --- | --- |
| Windows | `%APPDATA%\fin-agent\` |
| macOS / Linux | `~/.config/fin-agent/`；设置了 `XDG_CONFIG_HOME` 时使用该目录下的 `fin-agent/`。 |

模型密钥等配置保存在该目录的 `.env` 中，应用选项保存在 `app_config.json` 中。迁移设备前可备份此目录；分享日志或配置时请移除密钥和个人数据。Electron 运行日志 `app.log` 则位于其自身的 `userData` 目录。

## 常见问题

- **启动后无法连接后端**：确认依赖安装到了 `build_venv`，检查开发终端输出或 `app.log`，并确认本机 `5678` 端口没有被其他进程占用。
- **模型能聊天，但无法查询数据**：检查所选模型是否支持工具调用，以及数据源网络连接、Token 和接口权限。
- **本地模型列表为空**：确认 Ollama 或 LM Studio 服务已经启动、模型已准备好，并检查接口地址。
- **预警没有触发**：确认应用仍在运行，并检查预警条件、轮询周期及「仅交易时段」设置；预警按轮询执行。
- **升级后表现没有变化**：从托盘完全退出应用后重新打开，确保主进程和 Python 后端均已重启。

## 更新与反馈

- [v1.1.1](docs/RELEASE-NOTES-1.1.1.md)：修复回复截断、报告卡住、空卡片和表格展示等问题。
- [v1.1.0](docs/RELEASE-NOTES-1.1.0.md)：加入投资仪表盘、投资画像向导、结构化报告、研报夹和自选新闻订阅。
- [后续计划](ROADMAP.md)：查看规划中的能力。

遇到问题或有功能建议，欢迎提交 [Issue](https://github.com/YUHAI0/fin-agent-desktop/issues)，附上应用版本、操作系统、复现步骤和脱敏后的日志。

## 许可证

本项目采用 [MIT License](LICENSE)。
