import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Settings } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  logs?: string
}

const ChatView: React.FC = () => {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [version, setVersion] = useState('...')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping])

  // Keep focus on input at all times
  useEffect(() => {
    inputRef.current?.focus()
  }, [messages, isTyping])

  // Load version on mount
  useEffect(() => {
    window.api.getVersion().then(v => setVersion(v))
  }, [])

  useEffect(() => {
    const removeListener = window.api.onNewMessage((text) => {
      console.log('[ChatView] Received new-message:', text)
      if (text) {
        setMessages(prev => [...prev, { role: 'user', content: text }])
        setIsTyping(true)
        // Don't create assistant message yet - wait for first stream event
      }
    })

    const removeBotStreamListener = window.api.onBotStream((data: any) => {
        if (!data) return;
        
        console.log('[ChatView] Received bot-stream event:', data.type)
        
        // Hide typing indicator as soon as we receive any content from AI
        if (data.type === 'content' || data.type === 'answer') {
            console.log('[ChatView] Received content/answer, hiding typing indicator')
            setIsTyping(false)
        } else if (data.type === 'error' || data.type === 'finish') {
            console.log('[ChatView] Received error/finish, hiding typing indicator')
            setIsTyping(false)
        }
        
        setMessages(prev => {
            const newMessages = [...prev]
            const lastMsg = newMessages[newMessages.length - 1]
            
            // If last message is not assistant, create one (first event)
            if (!lastMsg || lastMsg.role !== 'assistant') {
                newMessages.push({ role: 'assistant', content: '', logs: '' })
            }
            
            const assistantMsg = newMessages[newMessages.length - 1]
            
            if (data.type === 'content') {
                assistantMsg.content += data.content
            } else if (data.type === 'answer') {
                // Some providers only return a final answer event (no streamed content).
                // Avoid duplicating content if we already streamed it.
                if (!assistantMsg.content || assistantMsg.content.trim() === '') {
                    assistantMsg.content = data.content || ''
                }
            } else if (data.type === 'thinking') {
                assistantMsg.logs = (assistantMsg.logs || '') + `[Thinking] ${data.content}\n`
            } else if (data.type === 'log') {
                assistantMsg.logs = (assistantMsg.logs || '') + `[Log] ${data.content}\n`
            } else if (data.type === 'tool_call') {
                assistantMsg.logs = (assistantMsg.logs || '') + `[Tool Call] ${data.tool_name}(${data.args})\n`
            } else if (data.type === 'tool_result') {
                 // Truncate long results for display
                const rawResult = data?.result == null ? '' : String(data.result)
                const resultStr = rawResult.length > 500 ? rawResult.substring(0, 500) + '...' : rawResult
                assistantMsg.logs = (assistantMsg.logs || '') + `[Tool Result] ${resultStr}\n`
            } else if (data.type === 'error') {
                assistantMsg.content += `\n**Error:** ${data.content}`
            } else if (data.type === 'finish') {
                // If we never received any meaningful payload, avoid leaving an empty assistant bubble.
                if (!assistantMsg.content || assistantMsg.content.trim() === '') {
                    assistantMsg.content = assistantMsg.content || ''
                }
            }
            
            return newMessages
        })
    })

    // Keep legacy listener for backward compatibility if needed, but mainly use stream now
    const removeBotListener = window.api.onBotResponse((data: any) => {
      if (data && data.answer) {
         // ... legacy logic
         setMessages(prev => {
             // ...
             return prev // disabled for now to avoid confusion if legacy event fires
         })
         // setIsTyping(false)
      }
    })

    const removeFocusListener = window.api.onFocusInput(() => {
      console.log('[ChatView] Received focus-input event')
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    })
    
    return () => {
      removeListener()
      removeBotListener()
      removeBotStreamListener()
      removeFocusListener()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[ChatView] handleSubmit called, input:', input)
    if (!input.trim()) {
      console.log('[ChatView] Input is empty, returning')
      return
    }
    
    // Check config first
    try {
      const status = await window.api.checkConfig()
      if (!status.configured) {
        if (confirm(`Configuration incomplete: ${status.message || 'Missing Tokens'}\n\nGo to settings?`)) {
          navigate('/config')
        }
        return
      }
    } catch (err) {
      console.error('[ChatView] Config check failed:', err)
      // If check fails, we might still want to try sending
    }

    console.log('[ChatView] Sending input to main process:', input)
    // Send to main process
    window.api.submitInput(input)
    setInput('')
    // Keep focus on input after submit
    setTimeout(() => inputRef.current?.focus(), 0)
  }


  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white drag-region">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/50 backdrop-blur no-drag">
        <div className="font-semibold text-lg">Fin-Agent</div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/config')}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <div className="text-xs text-gray-500">v{version}</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 no-drag">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-800 text-gray-100'
            }`}>
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            
            {/* Logs Display */}
            {msg.role === 'assistant' && msg.logs && (
              <div className="max-w-[80%] mt-2">
                <details className="group">
                  <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300 select-none list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 transition-transform">▶</span>
                    Show Thinking Process
                  </summary>
                  <div className="mt-2 bg-black/50 rounded-lg p-3 overflow-x-auto border border-gray-800">
                    <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
                      {msg.logs}
                    </pre>
                  </div>
                </details>
              </div>
            )}
          </div>
        ))}
        {isTyping && (
           <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl px-4 py-3 flex gap-1 items-center">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100"></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-800 bg-gray-900/50 backdrop-blur no-drag">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            autoFocus
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button 
            type="submit"
            disabled={!input.trim() || isTyping}
            onClick={() => console.log('[ChatView] Send button clicked, isTyping:', isTyping, 'input:', input)}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-6 py-2 transition-colors font-medium"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default ChatView