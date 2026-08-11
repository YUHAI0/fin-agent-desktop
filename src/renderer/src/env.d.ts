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
    news_poll_interval_minutes?: 5 | 10 | 15 | 30
    news_sentiment_enabled?: boolean
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

type NewsSubscriptionType = 'sector' | 'topic' | 'portfolio'
type NewsSource = 'stock_news_em' | 'stock_info_global_cls' | 'stock_info_global_em'

interface NewsSubscription {
  id: string
  type: NewsSubscriptionType
  name: string
  enabled: boolean
  keywords: string[]
  exclude_keywords: string[]
  sources: NewsSource[]
  symbols?: string[]
  created_at: string
  updated_at: string
}

interface NewsSubscriptionInput {
  type: NewsSubscriptionType
  name?: string
  enabled?: boolean
  keywords?: string[]
  exclude_keywords?: string[]
  sources?: NewsSource[]
  symbols?: string[]
}

type NewsSubscriptionUpdate = Partial<Omit<NewsSubscriptionInput, 'type'>>

type NewsSentiment = 'bullish' | 'bearish' | 'neutral'

interface NotifiedNewsItem {
  id: string
  source: NewsSource
  source_id: string
  title: string
  summary: string
  url: string
  published_at: string
  symbols: string[]
  fingerprint: string
  title_day_fingerprint: string
  fingerprint_version: number
  read: boolean
  notification_pending: boolean
  pending_subscription_ids: string[]
  notified_at: string | null
  matched_subscription_ids: string[]
  matched_symbols: string[]
  related_sources: NewsSource[]
  source_alias_ids: string[]
  updated_at: string
  sentiment?: NewsSentiment | null
  sentiment_labeled_at?: string | null
}

interface NewsListFilters {
  page?: number
  pageSize?: number
  unread?: boolean
  type?: NewsSubscriptionType
  source?: NewsSource
  symbol?: string
  query?: string
  subscriptionId?: string
  newsId?: string
}

interface NewsPage {
  items: NotifiedNewsItem[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

interface NewsSourceHealthEntry {
  failure_count: number
  next_fetch_at: string | null
  last_success: string | null
  last_error: string | null
}

interface NewsSourceHealth {
  sources: Record<string, NewsSourceHealthEntry>
  symbol_sources: Record<string, Record<string, NewsSourceHealthEntry>>
}

interface NewsMonitorStatus {
  running: boolean
  cycle_running: boolean
  closed: boolean
  poll_interval_minutes: number
  last_started_at: string | null
  last_completed_at: string | null
  last_error: string | null
  source_health?: NewsSourceHealth
}

interface NewsNotificationOpenPayload {
  newsId?: string
  subscriptionId?: string
  subscriptionIds: string[]
  source?: NewsSource
  url?: string
}

interface PriceAlertNotificationOpenPayload {
  taskId?: string
  tsCode?: string
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
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    onFocusInput: (callback: () => void) => () => void
    onQuitConfirm: (callback: () => void) => () => void
    quitConfirmed: (confirmed: boolean) => void
    onNavigate: (callback: (route: string) => void) => () => void
    suspendShortcut: () => Promise<void>
    resumeShortcut: () => Promise<void>
    checkShortcut: (shortcut: string) => Promise<boolean>
    getAutoLaunch: () => Promise<boolean>
    setAutoLaunch: (enabled: boolean) => Promise<boolean>
    listSchedulerTasks: () => Promise<{ tasks?: unknown[]; error?: string }>
    removeSchedulerTask: (
      taskId: string
    ) => Promise<{ success?: boolean; removed?: boolean; error?: string }>
    listNewsSubscriptions: (
      filters?: { enabled?: boolean; type?: NewsSubscriptionType }
    ) => Promise<{ subscriptions: NewsSubscription[]; error?: string }>
    createNewsSubscription: (
      payload: NewsSubscriptionInput
    ) => Promise<{ success: boolean; subscription?: NewsSubscription; error?: string }>
    updateNewsSubscription: (
      id: string,
      payload: NewsSubscriptionUpdate
    ) => Promise<{ success: boolean; subscription?: NewsSubscription; error?: string }>
    deleteNewsSubscription: (
      id: string
    ) => Promise<{ success: boolean; deleted?: boolean; error?: string }>
    toggleNewsSubscription: (
      id: string,
      enabled: boolean
    ) => Promise<{ success: boolean; subscription?: NewsSubscription; error?: string }>
    listNews: (filters?: NewsListFilters) => Promise<NewsPage>
    getNewsUnreadCount: () => Promise<{ count: number; error?: string }>
    markNewsRead: (
      id: string,
      read?: boolean
    ) => Promise<{ success: boolean; error?: string }>
    markNewsReadBatch: (
      ids: string[],
      read?: boolean
    ) => Promise<{ success: boolean; changed?: number; error?: string }>
    markAllNewsRead: () => Promise<{ success: boolean; changed?: number; error?: string }>
    clearNews: () => Promise<{ success: boolean; cleared?: number; error?: string }>
    getNewsMonitorStatus: () => Promise<NewsMonitorStatus>
    refreshNews: () => Promise<{
      success: boolean
      accepted?: boolean
      status?: NewsMonitorStatus
      error?: string
    }>
    onNewsNotificationOpen: (
      callback: (payload: NewsNotificationOpenPayload) => void
    ) => () => void
    onPriceAlertNotificationOpen: (
      callback: (payload: PriceAlertNotificationOpenPayload) => void
    ) => () => void
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
    setTitleBarTheme: (theme: 'dark' | 'light') => Promise<void>
    platform: string
    getPendingUpdate: () => Promise<UpdateInfo | null>
    startUpdateDownload: () => Promise<{ success?: boolean; error?: string }>
    installUpdate: () => Promise<{ success?: boolean; error?: string }>
    updateToastDismiss: () => void
    onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void
    onUpdateDownloadProgress: (cb: (p: { percent: number; received: number; total: number }) => void) => () => void
    onUpdateDownloadDone: (cb: () => void) => () => void
    onUpdateDownloadError: (cb: (err: string) => void) => () => void
    onInAppNotification: (
      cb: (payload: InAppNotificationPayload) => void
    ) => () => void
  }
}

interface InAppNotificationPayload {
  title: string
  body: string
  type?: string
  newsId?: string | null
  subscriptionId?: string | null
  taskId?: string
  tsCode?: string
}

interface UpdateInfo {
  version: string
  tagName: string
  downloadUrl: string
  fileName: string
  releaseNotes: string
}
