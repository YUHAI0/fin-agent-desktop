import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'

const ConfigView: React.FC = () => {
  const navigate = useNavigate()
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortcutStatus, setShortcutStatus] = useState<{valid: boolean, message: string} | null>(null)

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.api.getConfig()
        if (config) {
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
              placeholder="输入 Tushare Token"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">LLM 提供商</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI / Compatible</option>
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
            <div className="space-y-4 border-l-2 border-green-600 pl-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">API 密钥</label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
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

