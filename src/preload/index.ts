import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import os from 'os'

type Unsubscribe = () => void

// Ensure we only ever register ONE ipcRenderer listener per channel.
// We fan-out to multiple renderer callbacks via a Set, which is resilient to
// React StrictMode double-mount and hot reload edge cases.
function createChannelBridge<T>(channel: string) {
  const callbacks = new Set<(payload: T) => void>()

  // In dev, preload can be reloaded and this module re-executed.
  // Ensure we don't accumulate duplicated listeners for the same channel.
  ipcRenderer.removeAllListeners(channel)

  ipcRenderer.on(channel, (_event, payload: T) => {
    for (const cb of callbacks) cb(payload)
  })

  return (cb: (payload: T) => void): Unsubscribe => {
    callbacks.add(cb)
    return () => callbacks.delete(cb)
  }
}

type NewsCardPayload = {
  intent: 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'
  news: {
    id: string
    title: string
    summary: string
    url: string
    source: string
    published_at: string
    sentiment?: string | null
    matched_symbols: string[]
  }
}

type ChatNewMessagePayload = {
  text: string
  sessionId?: string
  newsCard?: NewsCardPayload
}

const onNewMessageBridge = createChannelBridge<ChatNewMessagePayload | string>('new-message')
const onBotResponseBridge = createChannelBridge<any>('bot-response')
const onBotStreamBridge = createChannelBridge<any>('bot-stream')
const onFocusInputBridge = createChannelBridge<void>('focus-input')
const onQuitConfirmBridge = createChannelBridge<void>('quit-confirm')
const onNavigateBridge = createChannelBridge<string>('navigate-route')
const onChatPrefillBridge = createChannelBridge<string>('chat-prefill')
const onNewsNotificationOpenBridge = createChannelBridge<{
  newsId?: string
  subscriptionId?: string
  subscriptionIds: string[]
  source?: string
  url?: string
}>('news-notification-open')
const onPriceAlertNotificationOpenBridge = createChannelBridge<{
  taskId?: string
  tsCode?: string
}>('price-alert-notification-open')

interface UpdateInfo {
  version: string
  tagName: string
  downloadUrl: string
  fileName: string
  releaseNotes: string
}
const onUpdateAvailableBridge = createChannelBridge<UpdateInfo>('update-available')
const onUpdateDownloadProgressBridge = createChannelBridge<{ percent: number; received: number; total: number }>('update-download-progress')
const onUpdateDownloadDoneBridge = createChannelBridge<void>('update-download-done')
const onUpdateDownloadErrorBridge = createChannelBridge<string>('update-download-error')

// Toast 浮窗事件（仅在 /toast 路由窗口使用）
type ToastBusListener = (data: any) => void
const toastBusListeners = new Map<string, Set<ToastBusListener>>()
/** 缓存最近一次 show 载荷，避免 React 订阅前 toast-show 丢失导致空白窗 */
const lastToastBusPayload = new Map<string, unknown>()
const ELECTRON_BUS_CHANNELS = [
  'toast-show',
  'toast-dismiss',
  'update-show',
  'update-dismiss',
  'update-download-progress',
  'update-download-done',
  'update-download-error'
] as const
for (const ch of ELECTRON_BUS_CHANNELS) {
  ipcRenderer.removeAllListeners(ch)
  ipcRenderer.on(ch, (_event, data) => {
    if (ch === 'toast-show' || ch === 'update-show') {
      lastToastBusPayload.set(ch, data)
    } else if (ch === 'toast-dismiss') {
      lastToastBusPayload.delete('toast-show')
    } else if (ch === 'update-dismiss') {
      lastToastBusPayload.delete('update-show')
    }
    const listeners = toastBusListeners.get(ch)
    if (listeners) for (const cb of listeners) cb(data)
  })
}
const electronBus = {
  on(channel: string, cb: ToastBusListener): () => void {
    if (!toastBusListeners.has(channel)) toastBusListeners.set(channel, new Set())
    toastBusListeners.get(channel)!.add(cb)
    // 订阅时若已有缓存 show 载荷，立即回放（解决挂载前 IPC 已发出的竞态）
    if (
      (channel === 'toast-show' || channel === 'update-show') &&
      lastToastBusPayload.has(channel)
    ) {
      const cached = lastToastBusPayload.get(channel)
      queueMicrotask(() => {
        if (toastBusListeners.get(channel)?.has(cb)) cb(cached)
      })
    }
    return () => toastBusListeners.get(channel)?.delete(cb)
  }
}

const onInAppNotificationBridge = createChannelBridge<{
  title: string
  body: string
  type?: string
  newsId?: string | null
  subscriptionId?: string | null
  taskId?: string
  tsCode?: string
}>('in-app-notification')

type PositionPayload = {
  id?: string
  ts_code: string
  amount: number
  cost: number
  bought_at?: string
  note?: string
}

// Custom APIs for renderer
const api = {
  submitInput: (text: string, sessionId?: string, newsCard?: NewsCardPayload) =>
    ipcRenderer.send('submit-input', text, sessionId, newsCard),
  stopGeneration: (sessionId?: string) => ipcRenderer.send('stop-generation', sessionId),
  resizeInput: (height: number) => ipcRenderer.send('resize-input', height),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getConfigDir: () => ipcRenderer.invoke('get-config-dir'),
  checkConfig: () => ipcRenderer.invoke('check-config'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data: any) => ipcRenderer.invoke('save-config', data),
  listLocalModels: (payload: { backend?: string; base_url?: string; api_key?: string }) =>
    ipcRenderer.invoke('list-local-models', payload),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  saveProfile: (data: object) => ipcRenderer.invoke('save-profile', data),
  skipOnboarding: () => ipcRenderer.invoke('skip-onboarding'),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),
  openSettings: () => ipcRenderer.send('open-settings'),
  resetConversationContext: () => ipcRenderer.send('reset-conversation-context'),
  openExternal: async (url: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await ipcRenderer.invoke('open-external', url)
      if (res && typeof res.success === 'boolean') return res
      return { success: false, error: '打开链接无响应，请重启应用后重试' }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  },
  onNewMessage: (
    callback: (payload: ChatNewMessagePayload | string) => void
  ) => onNewMessageBridge(callback),
  onNavigate: (callback: (route: string) => void) => onNavigateBridge(callback),
  onChatPrefill: (callback: (text: string) => void) => onChatPrefillBridge(callback),
  onBotResponse: (callback: (data: any) => void) => onBotResponseBridge(callback),
  onBotStream: (callback: (data: any) => void) => onBotStreamBridge(callback),
  onFocusInput: (callback: () => void) => onFocusInputBridge(callback),
  onQuitConfirm: (callback: () => void) => onQuitConfirmBridge(callback),
  quitConfirmed: (confirmed: boolean) => ipcRenderer.send('quit-confirmed', confirmed),
  suspendShortcut: () => ipcRenderer.invoke('suspend-shortcut'),
  resumeShortcut: () => ipcRenderer.invoke('resume-shortcut'),
  checkShortcut: (shortcut: string) => ipcRenderer.invoke('check-shortcut', shortcut),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('set-auto-launch', enabled),
  listSchedulerTasks: () => ipcRenderer.invoke('list-scheduler-tasks'),
  removeSchedulerTask: (taskId: string) => ipcRenderer.invoke('remove-scheduler-task', taskId),
  createPriceAlertPct: (payload: {
    ts_code: string
    direction: 'up' | 'down'
    pct: number
    email?: string
  }) => ipcRenderer.invoke('create-price-alert-pct', payload),
  listAlertHistory: () => ipcRenderer.invoke('list-alert-history'),
  listNewsSubscriptions: (filters?: { enabled?: boolean; type?: string }) =>
    ipcRenderer.invoke('list-news-subscriptions', filters),
  createNewsSubscription: (payload: unknown) =>
    ipcRenderer.invoke('create-news-subscription', payload),
  updateNewsSubscription: (id: string, payload: unknown) =>
    ipcRenderer.invoke('update-news-subscription', id, payload),
  deleteNewsSubscription: (id: string) =>
    ipcRenderer.invoke('delete-news-subscription', id),
  toggleNewsSubscription: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-news-subscription', id, enabled),
  listNews: (filters?: {
    page?: number
    pageSize?: number
    unread?: boolean
    type?: string
    source?: string
    symbol?: string
    query?: string
    subscriptionId?: string
    newsId?: string
  }) => ipcRenderer.invoke('list-news', filters),
  getNewsUnreadCount: () => ipcRenderer.invoke('get-news-unread-count'),
  markNewsRead: (id: string, read: boolean = true) =>
    ipcRenderer.invoke('mark-news-read', id, read),
  markNewsReadBatch: (ids: string[], read: boolean = true) =>
    ipcRenderer.invoke('mark-news-read-batch', ids, read),
  markAllNewsRead: () => ipcRenderer.invoke('mark-all-news-read'),
  clearNews: () => ipcRenderer.invoke('clear-news'),
  getNewsMonitorStatus: () => ipcRenderer.invoke('get-news-monitor-status'),
  refreshNews: () => ipcRenderer.invoke('refresh-news'),
  onNewsNotificationOpen: (
    callback: (payload: {
      newsId?: string
      subscriptionId?: string
      subscriptionIds: string[]
      source?: string
      url?: string
    }) => void
  ) => onNewsNotificationOpenBridge(callback),
  onPriceAlertNotificationOpen: (
    callback: (payload: { taskId?: string; tsCode?: string }) => void
  ) => onPriceAlertNotificationOpenBridge(callback),
  listSessions: (offset: number, limit: number) => ipcRenderer.invoke('list-sessions', offset, limit),
  getSession: (id: string) => ipcRenderer.invoke('get-session', id),
  createSession: (title?: string) => ipcRenderer.invoke('create-session', title),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('rename-session', id, title),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke('pin-session', id, pinned),
  searchSessions: (keyword: string) => ipcRenderer.invoke('search-sessions', keyword),
  saveSessionUi: (id: string, uiMessages: unknown[]) => ipcRenderer.invoke('save-session-ui', id, uiMessages),
  listPortfolios: () => ipcRenderer.invoke('list-portfolios'),
  getDashboardSummary: (portfolioId?: string) =>
    ipcRenderer.invoke('get-dashboard-summary', portfolioId),
  setActivePortfolio: (id: string) => ipcRenderer.invoke('set-active-portfolio', id),
  generateDashboardComment: (payload: object) =>
    ipcRenderer.invoke('generate-dashboard-comment', payload),
  getPortfolioDetail: (id?: string) => ipcRenderer.invoke('get-portfolio-detail', id),
  createPortfolio: (name: string) => ipcRenderer.invoke('create-portfolio', name),
  renamePortfolio: (id: string, name: string) => ipcRenderer.invoke('rename-portfolio', id, name),
  deletePortfolio: (id: string) => ipcRenderer.invoke('delete-portfolio', id),
  addPosition: (payload: PositionPayload) => ipcRenderer.invoke('add-position', payload),
  updatePosition: (payload: PositionPayload) => ipcRenderer.invoke('update-position', payload),
  deletePosition: (id: string | undefined, tsCode: string) => ipcRenderer.invoke('delete-position', id, tsCode),
  searchStocks: (q: string) => ipcRenderer.invoke('search-stocks', q),
  getStockQuote: (tsCode: string) => ipcRenderer.invoke('get-stock-quote', tsCode),
  getStockKline: (tsCode: string, period?: string) =>
    ipcRenderer.invoke('get-stock-kline', tsCode, period),
  getStockValuation: (tsCode: string) => ipcRenderer.invoke('get-stock-valuation', tsCode),
  getStockFinancials: (tsCode: string) => ipcRenderer.invoke('get-stock-financials', tsCode),
  getStockMoneyflow: (tsCode: string) => ipcRenderer.invoke('get-stock-moneyflow', tsCode),
  setTitleBarTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('set-title-bar-theme', theme),
  platform: process.platform,
  windowBackdrop: (() => {
    if (process.platform === 'darwin') return 'vibrancy' as const
    if (process.platform !== 'win32') return 'none' as const
    const build = Number(os.release().split('.')[2] || 0)
    return Number.isFinite(build) && build >= 22000 ? ('mica' as const) : ('none' as const)
  })(),
  getPendingUpdate: () => ipcRenderer.invoke('get-pending-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  resizeUpdateToast: (height: number) => ipcRenderer.invoke('resize-update-toast', height),
  updateToastReady: () => ipcRenderer.send('update-toast-ready'),
  resizeToast: (height: number, variant?: 'news' | 'price_alert' | 'default') =>
    ipcRenderer.invoke('resize-toast', height, variant),
  setToastChrome: (theme?: string) => ipcRenderer.invoke('set-toast-chrome', theme),
  startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  updateToastDismiss: () => ipcRenderer.send('update-toast-dismiss'),
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => onUpdateAvailableBridge(cb),
  onUpdateDownloadProgress: (cb: (p: { percent: number; received: number; total: number }) => void) => onUpdateDownloadProgressBridge(cb),
  onUpdateDownloadDone: (cb: () => void) => onUpdateDownloadDoneBridge(cb),
  onUpdateDownloadError: (cb: (err: string) => void) => onUpdateDownloadErrorBridge(cb),
  toastClick: () => ipcRenderer.send('toast-click'),
  toastClose: () => ipcRenderer.send('toast-close'),
  focusMainPrefill: (text: string) => ipcRenderer.send('focus-main-prefill', text),
  toastShown: () => ipcRenderer.send('toast-shown'),
  debugShowToast: () => ipcRenderer.invoke('debug-show-toast'),
  getPendingToast: () =>
    ipcRenderer.invoke('get-pending-toast') as Promise<{
      _title: string
      _body: string
      type?: string
      news_id?: string | null
      subscription_id?: string | null
      task_id?: string
      ts_code?: string
      _winId?: number
    } | null>,
  onInAppNotification: (
    cb: (payload: {
      title: string
      body: string
      type?: string
      newsId?: string | null
      subscriptionId?: string | null
      taskId?: string
      tsCode?: string
    }) => void
  ) => onInAppNotificationBridge(cb)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('electronBus', electronBus)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.electronBus = electronBus
}

