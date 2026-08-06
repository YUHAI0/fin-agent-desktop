import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; model: string; keyUrl: string; color: string; keyPlaceholder: string }> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', color: 'blue', keyPlaceholder: 'sk-...' },
  kimi: { label: 'Kimi (月之暗面)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-128k', keyUrl: 'https://platform.moonshot.cn/console/api-keys', color: 'purple', keyPlaceholder: 'sk-...' },
  glm: { label: 'GLM (智谱清言)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', color: 'emerald', keyPlaceholder: '' },
  qwen: { label: 'Qwen (通义千问)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyUrl: 'https://dashscope.console.aliyun.com/apiKey', color: 'orange', keyPlaceholder: 'sk-...' },
  siliconflow: { label: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', keyUrl: 'https://cloud.siliconflow.cn/account/ak', color: 'cyan', keyPlaceholder: 'sk-...' },
  openai: { label: 'OpenAI / 自定义', baseUrl: '', model: '', keyUrl: '', color: 'gray', keyPlaceholder: 'sk-...' },
}

const ConfigView: React.FC = () => {
  const navigate = useNavigate()
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
        email_receiver: emailReceiver
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
    <div className="flex flex-col h-screen bg-gray-900 text-white drag-region overflow-y-auto">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <button
          onClick={() => navigate('/chat')}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800 no-drag"
          title="返回聊天"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="font-semibold text-lg">配置</div>
      </div>

      <div className="p-8 no-drag max-w-2xl mx-auto w-full">
        <p className="mb-6 text-gray-400">请配置必要的 API 密钥以继续使用。</p>

        {error && (
          <div className="mb-6 bg-red-900/50 border border-red-800 text-red-200 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">行情数据源</label>
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value as 'akshare' | 'tushare')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="akshare">akshare（免费，推荐）</option>
              <option value="tushare">tushare（需 Token）</option>
            </select>
            <p className="text-xs text-gray-500">
              akshare 无需注册即可使用，覆盖 A 股基础信息、日线、实时行情、每日指标、利润表与指数行情。
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="block text-sm font-medium text-gray-300">Tushare Token</label>
              <button
                type="button"
                onClick={() => window.api.openExternal('https://tushare.pro/register')}
                className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 text-xs"
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
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="选填，输入 Tushare Token"
            />
            <p className="text-xs text-gray-500">
              选填。填写后可解锁选股筛选、港美股、ETF、可转债、期货与宏观数据等增强功能；即便数据源选择 akshare，此处的 Token 依然生效。
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">LLM 提供商</label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </div>

          {provider === 'deepseek' ? (
            <div className="space-y-4 border-l-2 border-blue-600 pl-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="block text-sm font-medium text-gray-300">DeepSeek API Key</label>
                  <button
                    type="button"
                    onClick={() => window.api.openExternal('https://platform.deepseek.com/api_keys')}
                    className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 text-xs"
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="sk-..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">基础 URL</label>
                    <input
                      type="text"
                      value={deepseekBase}
                      onChange={(e) => setDeepseekBase(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">模型</label>
                    <input
                      type="text"
                      value={deepseekModel}
                      onChange={(e) => setDeepseekModel(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
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
                  <label className="block text-sm font-medium text-gray-300">
                    {PROVIDER_PRESETS[provider]?.label || provider} API Key
                  </label>
                  {PROVIDER_PRESETS[provider]?.keyUrl && (
                    <button
                      type="button"
                      onClick={() => window.api.openExternal(PROVIDER_PRESETS[provider].keyUrl)}
                      className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 text-xs"
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder={PROVIDER_PRESETS[provider]?.keyPlaceholder || 'sk-...'}
                  required
                />
              </div>
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">基础 URL</label>
                    <input
                      type="text"
                      value={openaiBase}
                      onChange={(e) => setOpenaiBase(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="例如：https://api.openai.com/v1"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">模型</label>
                    <input
                      type="text"
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="例如：gpt-4"
                    />
                 </div>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-6 border-t border-gray-800">
             <h3 className="text-lg font-medium text-gray-200">系统</h3>
             <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">唤醒快捷键</label>
                <input
                  type="text"
                  value={wakeUpShortcut}
                  onChange={(e) => setWakeUpShortcut(e.target.value)}
                  onKeyDown={handleShortcutKeyDown}
                  onFocus={handleShortcutFocus}
                  onBlur={handleShortcutBlur}
                  className={`w-full bg-gray-800 border ${shortcutStatus && !shortcutStatus.valid ? 'border-red-500' : 'border-gray-700'} rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer hover:bg-gray-750`}
                  placeholder="点击此处并按下按键（例如：Ctrl+Alt+Q）"
                  title="点击以聚焦并输入您的快捷键"
                />
                <div className="flex justify-between items-center text-xs">
                    <p className="text-gray-500">点击输入框并按下按键组合。Backspace/Delete 清除。</p>
                    {shortcutStatus && (
                        <span className={shortcutStatus.valid ? 'text-green-500' : 'text-red-400'}>
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
                  <label className="block text-sm font-medium text-gray-300">开机自动启动</label>
                  <p className="text-xs text-gray-500">系统启动时自动运行 Fin-Agent</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await window.api.setAutoLaunch(!autoLaunch)
                    setAutoLaunch(result)
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoLaunch ? 'bg-blue-600' : 'bg-gray-600'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoLaunch ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
             </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-gray-800">
            <h3 className="text-lg font-medium text-gray-200">邮件通知（可选）</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">SMTP 服务器</label>
                <input
                  type="text"
                  value={emailServer}
                  onChange={(e) => setEmailServer(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. smtp.gmail.com"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">SMTP 端口</label>
                <input
                  type="text"
                  value={emailPort}
                  onChange={(e) => setEmailPort(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="465"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">发件人邮箱</label>
              <input
                type="email"
                value={emailSender}
                onChange={(e) => setEmailSender(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="sender@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">发件人密码 / 应用密码</label>
              <input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="********"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">收件人邮箱（默认为发件人）</label>
              <input
                type="email"
                value={emailReceiver}
                onChange={(e) => setEmailReceiver(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="receiver@example.com"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-6 py-3 font-medium transition-colors"
          >
            {loading ? '保存中...' : '保存配置'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ConfigView

