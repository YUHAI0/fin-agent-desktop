import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type ChatBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { 
      type: 'tool_execution'
      name: string
      args: string
      result?: string
      status: 'running' | 'success' | 'error'
      lastChunkLength?: number
      /** 流式 tool_calls 的下标，用于并行多工具时区分参数归属 */
      callIndex?: number
      /** 流式拼接的 tool call id，与 tool_result 对齐 */
      callId?: string
    }

export interface Message {
  role: 'user' | 'assistant'
  content: string // Kept for legacy compatibility
  blocks: ChatBlock[]
  logs?: string // Kept for legacy
}

interface ChatContextType {
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  addMessage: (message: Message) => void
  clearMessages: () => void
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

const STORAGE_KEY = 'fin-agent-chat-history'

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [messages, setMessages] = useState<Message[]>([])

  // 从 localStorage 加载历史记录
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          setMessages(parsed)
        }
      }
    } catch (err) {
      console.error('[ChatContext] Failed to load chat history:', err)
    }
  }, [])

  // 监听程序退出时的清空聊天历史事件
  useEffect(() => {
    if (window.api && window.api.onClearChatHistory) {
      const removeListener = window.api.onClearChatHistory(() => {
        console.log('[ChatContext] Received clear-chat-history event')
        setMessages([])
        try {
          localStorage.removeItem(STORAGE_KEY)
          console.log('[ChatContext] Chat history cleared')
        } catch (err) {
          console.error('[ChatContext] Failed to clear chat history:', err)
        }
      })
      return removeListener
    }
    // 如果条件不满足，返回 undefined（清理函数可选）
    return undefined
  }, [])

  // 保存到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch (err) {
      console.error('[ChatContext] Failed to save chat history:', err)
    }
  }, [messages])

  const addMessage = (message: Message) => {
    setMessages(prev => [...prev, message])
  }

  const clearMessages = () => {
    setMessages([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
      console.error('[ChatContext] Failed to clear chat history:', err)
    }
  }

  return (
    <ChatContext.Provider value={{ messages, setMessages, addMessage, clearMessages }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChat = () => {
  const context = useContext(ChatContext)
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}

