import React, { useState, useEffect, useRef } from 'react'
import { Search, Settings } from 'lucide-react'

const InputView: React.FC = () => {
  const [value, setValue] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.classList.add('fa-quick-input-page')
    return () => {
      document.documentElement.classList.remove('fa-quick-input-page')
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()

    const removeFocusListener = window.api.onFocusInput(() => {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    })

    const removeBotStreamListener = window.api.onBotStream((data: any) => {
      if (!data) return
      setIsResponding((prev) => {
        if (
          !prev &&
          (data.type === 'content' ||
            data.type === 'answer' ||
            data.type === 'thinking' ||
            data.type === 'tool_call' ||
            data.type === 'tool_call_chunk')
        ) {
          return true
        }
        if (data.type === 'error' || data.type === 'finish') {
          return false
        }
        return prev
      })
    })

    const removeNewMessageListener = window.api.onNewMessage((payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text
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
    if (e.key === 'Enter' && isResponding) {
      e.preventDefault()
      return
    }

    if (e.key === 'Enter') {
      if (value.trim()) {
        try {
          const status = await window.api.checkConfig()
          if (!status.configured) {
            window.api.openSettings()
            return
          }
          window.api.submitInput(value)
          setValue('')
          setIsResponding(true)
        } catch {
          window.api.openSettings()
        }
      }
    } else if (e.key === 'Escape') {
      window.api.submitInput('')
    }
  }

  return (
    <div className="fa-quick-input-shell">
      <div className="fa-quick-input-inner">
        <Search className="fa-quick-input-icon" size={22} strokeWidth={1.75} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className="fa-quick-input-field"
          placeholder={isResponding ? 'Fin-Agent 正在回复…' : '输入任何关于投资的问题…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button
          type="button"
          onClick={() => window.api.openSettings()}
          className="fa-quick-input-settings"
          title="设置"
          aria-label="设置"
        >
          <Settings size={20} />
        </button>
      </div>
    </div>
  )
}

export default InputView
