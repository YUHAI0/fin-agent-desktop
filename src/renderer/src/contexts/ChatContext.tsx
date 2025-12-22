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

