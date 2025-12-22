import React, { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'

const InputView: React.FC = () => {
  const [value, setValue] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()

    const removeFocusListener = window.api.onFocusInput(() => {
        console.log('[InputView] Received focus-input event')
        setTimeout(() => {
            inputRef.current?.focus()
        }, 50)
    })
    
    // 监听AI响应状态
    const removeBotStreamListener = window.api.onBotStream((data: any) => {
        if (!data) return
        
        // 标记AI正在响应
        setIsResponding(prev => {
            if (!prev && (data.type === 'content' || data.type === 'answer' || data.type === 'thinking' || data.type === 'tool_call' || data.type === 'tool_call_chunk')) {
                return true
            }
            if (data.type === 'error' || data.type === 'finish') {
                return false // AI响应结束
            }
            return prev
        })
    })
    
    // 监听新消息，标记AI开始响应
    const removeNewMessageListener = window.api.onNewMessage((text: string) => {
        if (text) {
            setIsResponding(true)
        }
    })

    return () => {
        removeFocusListener()
        removeBotStreamListener()
        removeNewMessageListener()
    }
  }, [])

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    // 如果AI正在响应，禁止回车提交
    if (e.key === 'Enter' && isResponding) {
      e.preventDefault()
      return
    }
    
    if (e.key === 'Enter') {
      if (value.trim()) {
        try {
          const status = await window.api.checkConfig()
          if (!status.configured) {
            // 快捷键输入框太小，直接跳转到配置页面
            window.api.openSettings()
            return
          }
          window.api.submitInput(value)
          setValue('')
          setIsResponding(true) // 标记AI开始响应
        } catch (err) {
          console.error('Config check failed:', err)
          // Still try to submit if check fails, maybe network issue?
          // Or safeguard and block? Let's block to be safe or just submit.
          // Probably better to submit so we don't block user on backend error.
          window.api.submitInput(value)
          setValue('')
          setIsResponding(true) // 标记AI开始响应
        }
      }
    } else if (e.key === 'Escape') {
        // Optional: Hide window on Escape. Sending empty might trigger hide in main logic if we handle it.
        // For now, let's just assume main handles focus loss or we can add a specific hide IPC.
        window.api.submitInput('') 
    }
  }

  return (
    <div className="h-screen w-full flex items-center justify-center bg-gray-900/90 rounded-xl overflow-hidden border border-gray-700 shadow-2xl drag-region">
      <div className="w-full px-4 flex items-center gap-4 no-drag h-full">
        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-transparent text-white text-2xl outline-none placeholder-gray-500 font-light h-full py-4"
          placeholder={isResponding ? "Agent is responding..." : "Ask anything..."}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button
          onClick={() => window.api.openSettings()}
          className="text-gray-400 hover:text-white transition-colors p-2 rounded hover:bg-gray-800"
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </div>
    </div>
  )
}

export default InputView

