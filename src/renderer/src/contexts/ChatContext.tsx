import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { createWelcomeAgentMessage } from '../utils/welcomeAgentMessage'

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

type MessagesUpdater = React.SetStateAction<Message[]>

interface ChatContextType {
  messages: Message[]
  setMessages: React.Dispatch<MessagesUpdater>
  /** 按会话 id 更新消息（流式事件路由到非活动标签时用） */
  updateSessionMessages: (sessionId: string, action: MessagesUpdater) => void
  addMessage: (message: Message) => void
  clearMessages: () => void
  openTabs: SessionMeta[]
  activeSessionId: string | null
  openSession: (id: string) => Promise<void>
  closeTab: (id: string) => void
  newSession: () => Promise<void>
  refreshTabs: () => Promise<void>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

const LEGACY_STORAGE_KEY = 'fin-agent-chat-history'
const MIGRATION_FLAG = 'fin-agent-session-migrated'
const OPEN_TABS_KEY = 'fin-agent-open-tabs'

/** 把 1.1.10 之前存在 localStorage 的单轨历史迁移为一个会话，仅执行一次。 */
async function migrateLegacyHistory(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return
  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Message[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const meta = await window.api.createSession('历史对话')
        await window.api.saveSessionUi(meta.id, parsed)
      }
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch (err) {
    console.error('[ChatContext] Legacy history migration failed:', err)
  } finally {
    localStorage.setItem(MIGRATION_FLAG, '1')
  }
}

function readOpenTabIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

function resolveMessages(action: MessagesUpdater, current: Message[]): Message[] {
  return typeof action === 'function' ? action(current) : action
}

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({})
  const [openTabs, setOpenTabs] = useState<SessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const messagesBySessionRef = useRef(messagesBySession)
  messagesBySessionRef.current = messagesBySession

  const messages =
    activeSessionId && messagesBySession[activeSessionId]
      ? messagesBySession[activeSessionId]
      : [createWelcomeAgentMessage()]

  const refreshTabs = useCallback(async () => {
    const ids = readOpenTabIds()
    if (ids.length === 0) {
      setOpenTabs([])
      return
    }
    const { sessions } = await window.api.listSessions(0, 200)
    const byId = new Map(sessions.map((s) => [s.id, s]))
    setOpenTabs(ids.map((id) => byId.get(id)).filter((s): s is SessionMeta => Boolean(s)))
  }, [])

  const persistOpenTabIds = useCallback((ids: string[]) => {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids))
  }, [])

  const updateSessionMessages = useCallback((sessionId: string, action: MessagesUpdater) => {
    setMessagesBySession((prev) => {
      const current = prev[sessionId] ?? [createWelcomeAgentMessage()]
      return { ...prev, [sessionId]: resolveMessages(action, current) }
    })
  }, [])

  const setMessages: React.Dispatch<MessagesUpdater> = useCallback(
    (action) => {
      if (!activeSessionId) return
      updateSessionMessages(activeSessionId, action)
    },
    [activeSessionId, updateSessionMessages]
  )

  const openSession = useCallback(
    async (id: string) => {
      const ids = readOpenTabIds()
      if (!ids.includes(id)) {
        persistOpenTabIds([...ids, id])
      }

      // 内存中已有该会话（例如后台仍在流式生成）时，不要用磁盘旧快照覆盖
      if (messagesBySessionRef.current[id] === undefined) {
        const body = await window.api.getSession(id)
        const ui = (body.ui_messages as Message[]) || []
        setMessagesBySession((prev) => {
          if (prev[id] !== undefined) return prev
          return { ...prev, [id]: ui.length > 0 ? ui : [createWelcomeAgentMessage()] }
        })
      }

      setActiveSessionId(id)
      await refreshTabs()
    },
    [persistOpenTabIds, refreshTabs]
  )

  const newSession = useCallback(async () => {
    const meta = await window.api.createSession()
    await openSession(meta.id)
  }, [openSession])

  const closeTab = useCallback(
    (id: string) => {
      const ids = readOpenTabIds().filter((x) => x !== id)
      persistOpenTabIds(ids)
      const snapshot = messagesBySessionRef.current[id]
      if (snapshot) {
        void window.api.saveSessionUi(id, snapshot).catch((err) => {
          console.error('[ChatContext] Failed to persist before close:', err)
        })
      }
      setMessagesBySession((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      void refreshTabs()
      if (activeSessionId === id) {
        if (ids.length > 0) {
          void openSession(ids[ids.length - 1])
        } else {
          void newSession()
        }
      }
    },
    [activeSessionId, newSession, openSession, persistOpenTabIds, refreshTabs]
  )

  // 所有内存中的会话消息防抖落盘（含后台流式标签）
  useEffect(() => {
    const entries = Object.entries(messagesBySession)
    if (entries.length === 0) return undefined
    const timer = setTimeout(() => {
      for (const [id, msgs] of entries) {
        void window.api.saveSessionUi(id, msgs).catch((err) => {
          console.error('[ChatContext] Failed to persist ui messages:', err)
        })
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [messagesBySession])

  // 启动：迁移旧数据 → 恢复上次打开的标签 → 没有则新建
  useEffect(() => {
    void (async () => {
      await migrateLegacyHistory()
      const ids = readOpenTabIds()
      if (ids.length > 0) {
        await openSession(ids[ids.length - 1])
      } else {
        const { sessions } = await window.api.listSessions(0, 1)
        if (sessions.length > 0) {
          await openSession(sessions[0].id)
        } else {
          await newSession()
        }
      }
    })()
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addMessage = (message: Message) => {
    setMessages((prev) => [...prev, message])
  }

  const clearMessages = () => {
    setMessages([createWelcomeAgentMessage()])
    if (activeSessionId) {
      void window.api.saveSessionUi(activeSessionId, [])
    }
  }

  return (
    <ChatContext.Provider
      value={{
        messages,
        setMessages,
        updateSessionMessages,
        addMessage,
        clearMessages,
        openTabs,
        activeSessionId,
        openSession,
        closeTab,
        newSession,
        refreshTabs
      }}
    >
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
