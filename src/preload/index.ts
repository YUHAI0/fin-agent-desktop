import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

const onNewMessageBridge = createChannelBridge<{ text: string; sessionId?: string } | string>('new-message')
const onBotResponseBridge = createChannelBridge<any>('bot-response')
const onBotStreamBridge = createChannelBridge<any>('bot-stream')
const onFocusInputBridge = createChannelBridge<void>('focus-input')
const onQuitConfirmBridge = createChannelBridge<void>('quit-confirm')
const onNavigateBridge = createChannelBridge<string>('navigate-route')
const onNewsNotificationOpenBridge = createChannelBridge<{
  newsId?: string
  subscriptionId?: string
  subscriptionIds: string[]
  source?: string
  url?: string
}>('news-notification-open')

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
  submitInput: (text: string, sessionId?: string) => ipcRenderer.send('submit-input', text, sessionId),
  stopGeneration: (sessionId?: string) => ipcRenderer.send('stop-generation', sessionId),
  resizeInput: (height: number) => ipcRenderer.send('resize-input', height),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getConfigDir: () => ipcRenderer.invoke('get-config-dir'),
  checkConfig: () => ipcRenderer.invoke('check-config'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data: any) => ipcRenderer.invoke('save-config', data),
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
  onNewMessage: (callback: (text: string) => void) => onNewMessageBridge(callback),
  onNavigate: (callback: (route: string) => void) => onNavigateBridge(callback),
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
  listSessions: (offset: number, limit: number) => ipcRenderer.invoke('list-sessions', offset, limit),
  getSession: (id: string) => ipcRenderer.invoke('get-session', id),
  createSession: (title?: string) => ipcRenderer.invoke('create-session', title),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('rename-session', id, title),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke('pin-session', id, pinned),
  searchSessions: (keyword: string) => ipcRenderer.invoke('search-sessions', keyword),
  saveSessionUi: (id: string, uiMessages: unknown[]) => ipcRenderer.invoke('save-session-ui', id, uiMessages),
  listPortfolios: () => ipcRenderer.invoke('list-portfolios'),
  getPortfolioDetail: (id?: string) => ipcRenderer.invoke('get-portfolio-detail', id),
  createPortfolio: (name: string) => ipcRenderer.invoke('create-portfolio', name),
  renamePortfolio: (id: string, name: string) => ipcRenderer.invoke('rename-portfolio', id, name),
  deletePortfolio: (id: string) => ipcRenderer.invoke('delete-portfolio', id),
  addPosition: (payload: PositionPayload) => ipcRenderer.invoke('add-position', payload),
  updatePosition: (payload: PositionPayload) => ipcRenderer.invoke('update-position', payload),
  deletePosition: (id: string | undefined, tsCode: string) => ipcRenderer.invoke('delete-position', id, tsCode),
  setTitleBarTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('set-title-bar-theme', theme),
  platform: process.platform
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

