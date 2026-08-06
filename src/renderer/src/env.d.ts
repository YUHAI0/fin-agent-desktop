// Add types for the new API methods
interface ConfigData {
    tushare_token: string
    provider: string
    deepseek_key?: string
    deepseek_base?: string
    deepseek_model?: string
    openai_key?: string
    openai_base?: string
    openai_model?: string
    wake_up_shortcut?: string
    email_server?: string
    email_port?: string
    email_sender?: string
    email_password?: string
    email_receiver?: string
    data_source?: 'akshare' | 'tushare'
    alert_poll_interval_minutes?: number
    alert_trading_hours_only?: boolean
}

interface SessionMeta {
  id: string
  title: string
  created_at: number
  updated_at: number
  pinned: boolean
  message_count: number
  preview: string
}

interface SessionBody {
  id: string
  llm_history: unknown[]
  ui_messages: unknown[]
}

declare interface Window {
  api: {
    submitInput: (text: string, sessionId?: string) => void
    stopGeneration: () => void
    resizeInput: (height: number) => void
    getVersion: () => Promise<string>
    onNewMessage: (callback: (text: string) => void) => () => void
    onBotResponse: (callback: (data: any) => void) => () => void
    onBotStream: (callback: (data: any) => void) => () => void
    checkConfig: () => Promise<{ configured: boolean; message?: string }>
    getConfig: () => Promise<ConfigData>
    saveConfig: (data: ConfigData) => Promise<{ success: boolean; error?: string; path?: string }>
    openSettings: () => void
    resetConversationContext: () => void
    openExternal: (url: string) => Promise<void>
    onFocusInput: (callback: () => void) => () => void
    onQuitConfirm: (callback: () => void) => () => void
    quitConfirmed: (confirmed: boolean) => void
    onNavigate: (callback: (route: string) => void) => void
    suspendShortcut: () => Promise<void>
    resumeShortcut: () => Promise<void>
    checkShortcut: (shortcut: string) => Promise<boolean>
    getAutoLaunch: () => Promise<boolean>
    setAutoLaunch: (enabled: boolean) => Promise<boolean>
    listSchedulerTasks: () => Promise<{ tasks?: unknown[]; error?: string }>
    removeSchedulerTask: (
      taskId: string
    ) => Promise<{ success?: boolean; removed?: boolean; error?: string }>
    listSessions: (offset: number, limit: number) => Promise<{ sessions: SessionMeta[]; total: number }>
    getSession: (id: string) => Promise<SessionBody>
    createSession: (title?: string) => Promise<SessionMeta>
    deleteSession: (id: string) => Promise<{ success: boolean; deleted: boolean }>
    renameSession: (id: string, title: string) => Promise<{ success: boolean }>
    pinSession: (id: string, pinned: boolean) => Promise<{ success: boolean }>
    searchSessions: (keyword: string) => Promise<{ sessions: SessionMeta[]; truncated: boolean }>
    saveSessionUi: (id: string, uiMessages: unknown[]) => Promise<{ success: boolean }>
  }
}
