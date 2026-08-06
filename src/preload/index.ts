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

// Custom APIs for renderer
const api = {
  submitInput: (text: string, sessionId?: string) => ipcRenderer.send('submit-input', text, sessionId),
  stopGeneration: (sessionId?: string) => ipcRenderer.send('stop-generation', sessionId),
  resizeInput: (height: number) => ipcRenderer.send('resize-input', height),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkConfig: () => ipcRenderer.invoke('check-config'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data: any) => ipcRenderer.invoke('save-config', data),
  openSettings: () => ipcRenderer.send('open-settings'),
  resetConversationContext: () => ipcRenderer.send('reset-conversation-context'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onNewMessage: (callback: (text: string) => void) => onNewMessageBridge(callback),
  onNavigate: (callback: (route: string) => void) => {
    ipcRenderer.on('navigate-route', (_event, route) => callback(route))
  },
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
  listSessions: (offset: number, limit: number) => ipcRenderer.invoke('list-sessions', offset, limit),
  getSession: (id: string) => ipcRenderer.invoke('get-session', id),
  createSession: (title?: string) => ipcRenderer.invoke('create-session', title),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('rename-session', id, title),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke('pin-session', id, pinned),
  searchSessions: (keyword: string) => ipcRenderer.invoke('search-sessions', keyword),
  saveSessionUi: (id: string, uiMessages: unknown[]) => ipcRenderer.invoke('save-session-ui', id, uiMessages)
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

