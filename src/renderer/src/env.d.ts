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

interface PortfolioMeta {
  id: string
  name: string
  created_at: string
  position_count: number
}

interface PortfolioPosition {
  ts_code: string
  name: string
  amount: number
  cost: number
  current_price: number
  estimated: boolean
  market_value: number
  pnl: number
  pnl_pct: number
  bought_at: string
  note: string
}

interface PortfolioDetail {
  portfolio_id: string
  portfolio_name: string
  positions: PortfolioPosition[]
  total_market_value: number
  total_cost_value: number
  total_pnl: number
  total_pnl_pct: number
}

interface PositionPayload {
  id?: string
  ts_code: string
  amount: number
  cost: number
  bought_at?: string
  note?: string
}

declare interface Window {
  api: {
    submitInput: (text: string, sessionId?: string) => void
    stopGeneration: (sessionId?: string) => void
    resizeInput: (height: number) => void
    getVersion: () => Promise<string>
    getConfigDir: () => Promise<string>
    onNewMessage: (
      callback: (payload: { text: string; sessionId?: string } | string) => void
    ) => () => void
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
    listPortfolios: () => Promise<{ active_portfolio_id: string; portfolios: PortfolioMeta[] }>
    getPortfolioDetail: (id?: string) => Promise<PortfolioDetail>
    createPortfolio: (name: string) => Promise<{ success: boolean; id?: string; error?: string }>
    renamePortfolio: (id: string, name: string) => Promise<{ success: boolean; error?: string }>
    deletePortfolio: (id: string) => Promise<{ success: boolean; error?: string }>
    addPosition: (payload: PositionPayload) => Promise<{ success: boolean; error?: string }>
    updatePosition: (payload: PositionPayload) => Promise<{ success: boolean; error?: string }>
    deletePosition: (id: string | undefined, tsCode: string) => Promise<{ success: boolean; error?: string }>
  }
}
