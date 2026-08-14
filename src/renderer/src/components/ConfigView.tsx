import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useAppDialog } from '../contexts/AppDialogContext'
import FaSelect from './FaSelect'
import SubPageShell from './SubPageShell'

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; model: string; keyUrl: string; color: string; keyPlaceholder: string }> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', color: 'blue', keyPlaceholder: 'sk-...' },
  kimi: { label: 'Kimi (月之暗面)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-128k', keyUrl: 'https://platform.moonshot.cn/console/api-keys', color: 'purple', keyPlaceholder: 'sk-...' },
  glm: { label: 'GLM (智谱清言)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', color: 'emerald', keyPlaceholder: '' },
  qwen: { label: 'Qwen (通义千问)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyUrl: 'https://dashscope.console.aliyun.com/apiKey', color: 'orange', keyPlaceholder: 'sk-...' },
  siliconflow: { label: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', keyUrl: 'https://cloud.siliconflow.cn/account/ak', color: 'cyan', keyPlaceholder: 'sk-...' },
  openai: { label: 'OpenAI / 自定义', baseUrl: '', model: '', keyUrl: '', color: 'gray', keyPlaceholder: 'sk-...' },
}

const NEWS_POLL_INTERVAL_OPTIONS = [5, 10, 15, 30] as const
const DEFAULT_NEWS_POLL_INTERVAL = 5

function normalizeNewsPollInterval(value: unknown): 5 | 10 | 15 | 30 {
  const num = Number(value)
  return (NEWS_POLL_INTERVAL_OPTIONS as readonly number[]).includes(num)
    ? (num as 5 | 10 | 15 | 30)
    : DEFAULT_NEWS_POLL_INTERVAL
}

const ConfigView: React.FC = () => {
  const navigate = useNavigate()
  const { alert } = useAppDialog()
  const [dataSource, setDataSource] = useState<'akshare' | 'tushare'>('akshare')
  const [tushareToken, setTushareToken] = useState('')
  const [provider, setProvider] = useState('deepseek')
  const [deepseekKey, setDeepseekKey] = useState('')
  const [deepseekBase, setDeepseekBase] = useState('https://api.deepseek.com')
  const [deepseekModel, setDeepseekModel] = useState('deepseek-chat')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiBase, setOpenaiBase] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [wakeUpShortcut, setWakeUpShortcut] = useState('Ctrl+Alt+Q')
  const [emailServer, setEmailServer] = useState('')
  const [emailPort, setEmailPort] = useState('465')
  const [emailSender, setEmailSender] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailReceiver, setEmailReceiver] = useState('')
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [alertInterval, setAlertInterval] = useState('10')
  const [tradingHoursOnly, setTradingHoursOnly] = useState(true)
  const [newsPollInterval, setNewsPollInterval] = useState(String(DEFAULT_NEWS_POLL_INTERVAL))
  const [newsSentimentEnabled, setNewsSentimentEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortcutStatus, setShortcutStatus] = useState<{valid: boolean, message: string} | null>(null)

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    if (newProvider !== 'deepseek' && newProvider !== 'openai') {
      const preset = PROVIDER_PRESETS[newProvider]
      if (preset) {
        setOpenaiBase(preset.baseUrl)
        setOpenaiModel(preset.model)
      }
    }
  }

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.api.getConfig()
        if (config) {
          setDataSource(config.data_source || 'akshare')
          setTushareToken(config.tushare_token || '')
          setProvider(config.provider || 'deepseek')
          setDeepseekKey(config.deepseek_key || '')
          setDeepseekBase(config.deepseek_base || 'https://api.deepseek.com')
          setDeepseekModel(config.deepseek_model || 'deepseek-chat')
          setOpenaiKey(config.openai_key || '')
          setOpenaiBase(config.openai_base || '')
          setOpenaiModel(config.openai_model || '')
          setWakeUpShortcut(config.wake_up_shortcut || 'Ctrl+Alt+Q')
          setEmailServer(config.email_server || '')
          setEmailPort(config.email_port || '465')
          setEmailSender(config.email_sender || '')
          setEmailPassword(config.email_password || '')
          setEmailReceiver(config.email_receiver || '')
          setAlertInterval(String(config.alert_poll_interval_minutes ?? 10))
          setTradingHoursOnly(config.alert_trading_hours_only ?? true)
          setNewsPollInterval(String(normalizeNewsPollInterval(config.news_poll_interval_minutes)))
          setNewsSentimentEnabled(config.news_sentiment_enabled ?? true)
        }
        const isAutoLaunch = await window.api.getAutoLaunch()
        setAutoLaunch(isAutoLaunch)
      } catch (err) {
        console.error('Failed to load config:', err)
      }
    }
    loadConfig()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const config = {
        data_source: dataSource,
        tushare_token: tushareToken,
        provider,
        deepseek_key: deepseekKey,
        deepseek_base: deepseekBase,
        deepseek_model: deepseekModel,
        openai_key: openaiKey,
        openai_base: openaiBase,
        openai_model: openaiModel,
        wake_up_shortcut: wakeUpShortcut,
        email_server: emailServer,
        email_port: emailPort,
        email_sender: emailSender,
        email_password: emailPassword,
        email_receiver: emailReceiver,
        alert_poll_interval_minutes: Math.min(Math.max(Number(alertInterval) || 10, 1), 120),
        alert_trading_hours_only: tradingHoursOnly,
        news_poll_interval_minutes: normalizeNewsPollInterval(newsPollInterval),
        news_sentiment_enabled: newsSentimentEnabled
      }

      const result = await window.api.saveConfig(config)
      if (result.success) {
        // Optional: Show success message or path
        console.log('Config saved to:', result.path)
        navigate('/chat')
      } else {
        setError(result.error || '保存配置失败')
      }
    } catch (err: any) {
      setError(err.message || '保存配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleShortcutKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.stopPropagation()

    // Clear on Backspace or Delete if no modifiers
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      setWakeUpShortcut('')
      setShortcutStatus(null)
      return
    }

    const key = e.key.toUpperCase()
    // Ignore standalone modifier presses
    if (['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) return

    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    if (e.metaKey) parts.push('Meta')

    // Handle special keys mapping to Electron Accelerator format
    let cleanKey = ''
    if (key === ' ') cleanKey = 'Space'
    else if (key === 'ESCAPE') cleanKey = 'Esc'
    else if (key === 'ARROWUP') cleanKey = 'Up'
    else if (key === 'ARROWDOWN') cleanKey = 'Down'
    else if (key === 'ARROWLEFT') cleanKey = 'Left'
    else if (key === 'ARROWRIGHT') cleanKey = 'Right'
    else if (e.key.length === 1) {
        // Regular character, use uppercase
        cleanKey = e.key.toUpperCase()
    } else {
        // Function keys (F1-F12) or others
        // Capitalize first letter (e.g. Tab, Enter)
        cleanKey = e.key.charAt(0).toUpperCase() + e.key.slice(1)
    }

    if (cleanKey) {
        parts.push(cleanKey)
        const newShortcut = parts.join('+')
        setWakeUpShortcut(newShortcut)
        
        // Check shortcut availability
        const isAvailable = await window.api.checkShortcut(newShortcut)
        if (!isAvailable) {
            setShortcutStatus({ valid: false, message: 'Shortcut is already in use by another application' })
        } else {
            setShortcutStatus({ valid: true, message: 'Shortcut available' })
        }
    }
  }

  const handleShortcutFocus = () => {
      window.api.suspendShortcut()
  }

  const handleShortcutBlur = () => {
      window.api.resumeShortcut()
      // Clear status on blur? Or keep it? Maybe keep it until save or change.
  }

  return (
    <SubPageShell>
      <div className="fa-page-header sticky top-0 z-10 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="cursor-pointer rounded-lg p-2 text-[var(--fa-muted)] transition-colors duration-200 hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
          title="返回聊天"
          aria-label="返回聊天"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="text-sm font-semibold">设置</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl p-8">
        <p className="mb-6 text-sm text-[var(--fa-muted)]">请配置必要的 API 密钥与系统选项。</p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="mb-8 flex w-full items-center justify-between rounded-xl border border-[var(--fa-border-subtle)] bg-[var(--fa-surface)] px-4 py-3 text-left transition hover:border-[var(--fa-accent)]/40"
        >
          <div>
            <div className="text-sm font-medium text-[var(--fa-text)]">投资画像</div>
            <p className="mt-1 text-xs text-[var(--fa-muted)]">经验等级、风险偏好与关注板块</p>
          </div>
          <span className="text-sm text-[var(--fa-accent)]">去设置 →</span>
        </button>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="fa-label">行情数据源</label>
            <FaSelect
              value={dataSource}
              aria-label="行情数据源"
              onChange={(v) => setDataSource(v as 'akshare' | 'tushare')}
              options={[
                { value: 'akshare', label: 'akshare（免费）' },
                { value: 'tushare', label: 'tushare（需 Token，推荐）' }
              ]}
            />
            <p className="fa-hint">
              akshare 无需注册即可使用，覆盖 A 股基础信息、日线、实时行情、每日指标、利润表与指数行情。
            </p>
            {!tushareToken.trim() && (
              <p className="fa-hint">
                当前未填写 Tushare Token，以下能力不可用：选股筛选、资金流、涨跌停/龙虎榜、业绩预告、概念成分、沪深港通、港美股、ETF、可转债、期货、宏观数据、全球指数对比。填写 Token 后即可解锁。
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="fa-label">Tushare Token</label>
              <button
                type="button"
                onClick={() => window.api.openExternal('https://tushare.pro/register')}
                className="fa-link"
                title="前往 Tushare 官网获取 Token"
              >
                <ExternalLink size={14} />
                <span>获取 Token</span>
              </button>
            </div>
            <input
              type="text"
              value={tushareToken}
              onChange={(e) => setTushareToken(e.target.value)}
              className="fa-input"
              placeholder="选填，输入 Tushare Token"
            />
            <p className="fa-hint">
              选填。填写后可解锁选股筛选、港美股、ETF、可转债、期货与宏观数据等增强功能；即便数据源选择 akshare，此处的 Token 依然生效。
            </p>
          </div>

          <div className="space-y-2">
            <label className="fa-label">LLM 提供商</label>
            <FaSelect
              value={provider}
              aria-label="LLM 提供商"
              onChange={handleProviderChange}
              options={Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({
                value: key,
                label: preset.label
              }))}
            />
          </div>

          {provider === 'deepseek' ? (
            <div className="space-y-4 border-l-2 border-[var(--fa-accent)] pl-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="fa-label">DeepSeek API Key</label>
                  <button
                    type="button"
                    onClick={() => window.api.openExternal('https://platform.deepseek.com/api_keys')}
                    className="fa-link"
                    title="前往 DeepSeek 平台获取 API Key"
                  >
                    <ExternalLink size={14} />
                    <span>获取 API Key</span>
                  </button>
                </div>
                <input
                  type="password"
                  value={deepseekKey}
                  onChange={(e) => setDeepseekKey(e.target.value)}
                  className="fa-input"
                  placeholder="sk-..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label className="fa-label">基础 URL</label>
                    <input
                      type="text"
                      value={deepseekBase}
                      onChange={(e) => setDeepseekBase(e.target.value)}
                      className="fa-input"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="fa-label">模型</label>
                    <input
                      type="text"
                      value={deepseekModel}
                      onChange={(e) => setDeepseekModel(e.target.value)}
                      className="fa-input"
                    />
                 </div>
              </div>
            </div>
          ) : (
            <div className={`space-y-4 border-l-2 pl-4 ${
              provider === 'kimi' ? 'border-purple-600' :
              provider === 'glm' ? 'border-emerald-600' :
              provider === 'qwen' ? 'border-orange-500' :
              provider === 'siliconflow' ? 'border-cyan-500' :
              'border-green-600'
            }`}>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="fa-label">
                    {PROVIDER_PRESETS[provider]?.label || provider} API Key
                  </label>
                  {PROVIDER_PRESETS[provider]?.keyUrl && (
                    <button
                      type="button"
                      onClick={() => window.api.openExternal(PROVIDER_PRESETS[provider].keyUrl)}
                      className="fa-link"
                      title="前往平台获取 API Key"
                    >
                      <ExternalLink size={14} />
                      <span>获取 API Key</span>
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  className="fa-input"
                  placeholder={PROVIDER_PRESETS[provider]?.keyPlaceholder || 'sk-...'}
                  required
                />
              </div>
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label className="fa-label">基础 URL</label>
                    <input
                      type="text"
                      value={openaiBase}
                      onChange={(e) => setOpenaiBase(e.target.value)}
                      className="fa-input"
                      placeholder="例如：https://api.openai.com/v1"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="fa-label">模型</label>
                    <input
                      type="text"
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="fa-input"
                      placeholder="例如：gpt-4"
                    />
                 </div>
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-[var(--fa-border-subtle)] pt-6">
             <h3 className="text-base font-medium text-[var(--fa-text)]">系统</h3>
             <div className="space-y-2">
                <label className="fa-label">唤醒快捷键</label>
                <input
                  type="text"
                  value={wakeUpShortcut}
                  onChange={(e) => setWakeUpShortcut(e.target.value)}
                  onKeyDown={handleShortcutKeyDown}
                  onFocus={handleShortcutFocus}
                  onBlur={handleShortcutBlur}
                  className={`fa-input cursor-pointer ${shortcutStatus && !shortcutStatus.valid ? '!border-red-500' : ''}`}
                  placeholder="点击此处并按下按键（例如：Ctrl+Alt+Q）"
                  title="点击以聚焦并输入您的快捷键"
                />
                <div className="flex flex-col gap-1 text-xs">
                    <p className="fa-hint">点击输入框并按下按键组合。Backspace/Delete 清除。</p>
                    <p className="fa-hint">快捷键显示/隐藏主窗口，与托盘图标行为一致。</p>
                    {shortcutStatus && (
                        <span className={shortcutStatus.valid ? 'text-emerald-400' : 'text-red-400'}>
                            {shortcutStatus.message === 'Shortcut is already in use by another application' 
                              ? '快捷键已被其他应用程序使用'
                              : shortcutStatus.message === 'Shortcut available'
                              ? '快捷键可用'
                              : shortcutStatus.message}
                        </span>
                    )}
                </div>
             </div>
             <div className="flex items-center justify-between py-2">
                <div>
                  <label className="fa-label">开机自动启动</label>
                  <p className="fa-hint">系统启动时自动运行 Fin-Agent</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await window.api.setAutoLaunch(!autoLaunch)
                    setAutoLaunch(result)
                  }}
                  className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${autoLaunch ? 'fa-toggle-on' : 'fa-toggle-off'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoLaunch ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
             </div>
             <div className="space-y-2">
                <label className="fa-label">价格提醒轮询间隔（分钟）</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={alertInterval}
                  onChange={(e) => setAlertInterval(e.target.value)}
                  onBlur={() => setAlertInterval(String(Math.min(Math.max(Number(alertInterval) || 10, 1), 120)))}
                  className="fa-input"
                />
                <p className="fa-hint">取值范围 1–120 分钟。修改后下一个轮询周期自动生效，无需重启。</p>
             </div>
             <div className="flex items-center justify-between py-2">
                <div>
                  <label className="fa-label">仅在交易时段轮询</label>
                  <p className="fa-hint">
                    开启后仅在交易日 9:15–11:30 与 12:55–15:05 检查。关闭后将 7×24 小时轮询。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTradingHoursOnly(!tradingHoursOnly)}
                  className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${tradingHoursOnly ? 'fa-toggle-on' : 'fa-toggle-off'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tradingHoursOnly ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
             </div>
             <div className="space-y-2">
                <label className="fa-label">新闻轮询频率</label>
                <FaSelect
                  value={newsPollInterval}
                  aria-label="新闻轮询频率"
                  onChange={setNewsPollInterval}
                  options={[
                    { value: '5', label: '每 5 分钟' },
                    { value: '10', label: '每 10 分钟' },
                    { value: '15', label: '每 15 分钟' },
                    { value: '30', label: '每 30 分钟' }
                  ]}
                />
                <p className="fa-hint">新闻监控独立运行，不受交易时段限制，按此频率 7×24 小时轮询订阅的新闻源。</p>
             </div>
             <div className="flex items-center justify-between py-2">
                <div>
                  <label className="fa-label">新闻利好/利空标注</label>
                  <p className="fa-hint">
                    开启后使用 LLM 自动为新闻打上利好、利空或中性标签，显示在新闻列表中。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewsSentimentEnabled(!newsSentimentEnabled)}
                  className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${newsSentimentEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${newsSentimentEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
             </div>
          </div>

          <div className="space-y-4 border-t border-[var(--fa-border-subtle)] pt-6">
            <h3 className="text-base font-medium text-[var(--fa-text)]">邮件通知（可选）</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="fa-label">SMTP 服务器</label>
                <input
                  type="text"
                  value={emailServer}
                  onChange={(e) => setEmailServer(e.target.value)}
                  className="fa-input"
                  placeholder="e.g. smtp.gmail.com"
                />
              </div>
              <div className="space-y-2">
                <label className="fa-label">SMTP 端口</label>
                <input
                  type="text"
                  value={emailPort}
                  onChange={(e) => setEmailPort(e.target.value)}
                  className="fa-input"
                  placeholder="465"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="fa-label">发件人邮箱</label>
              <input
                type="email"
                value={emailSender}
                onChange={(e) => setEmailSender(e.target.value)}
                className="fa-input"
                placeholder="sender@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="fa-label">发件人密码 / 应用密码</label>
              <input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                className="fa-input"
                placeholder="********"
              />
            </div>

            <div className="space-y-2">
              <label className="fa-label">收件人邮箱（默认为发件人）</label>
              <input
                type="email"
                value={emailReceiver}
                onChange={(e) => setEmailReceiver(e.target.value)}
                className="fa-input"
                placeholder="receiver@example.com"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="fa-btn-primary w-full py-3"
          >
            {loading ? '保存中...' : '保存配置'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/about')}
            className="fa-btn-ghost mt-3 w-full"
          >
            关于 / 支持本项目
          </button>
        </form>
      </div>
      </div>
    </SubPageShell>
  )
}

export default ConfigView

