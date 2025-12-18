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

const onNewMessageBridge = createChannelBridge<string>('new-message')
const onBotResponseBridge = createChannelBridge<any>('bot-response')
const onBotStreamBridge = createChannelBridge<any>('bot-stream')
const onFocusInputBridge = createChannelBridge<void>('focus-input')

// Custom APIs for renderer
const api = {
  submitInput: (text: string) => ipcRenderer.send('submit-input', text),
  resizeInput: (height: number) => ipcRenderer.send('resize-input', height),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkConfig: () => ipcRenderer.invoke('check-config'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data: any) => ipcRenderer.invoke('save-config', data),
  openSettings: () => ipcRenderer.send('open-settings'),
  resetConversationContext: () => ipcRenderer.send('reset-conversation-context'),
  onNewMessage: (callback: (text: string) => void) => onNewMessageBridge(callback),
  onNavigate: (callback: (route: string) => void) => {
    ipcRenderer.on('navigate-route', (_event, route) => callback(route))
  },
  onBotResponse: (callback: (data: any) => void) => onBotResponseBridge(callback),
  onBotStream: (callback: (data: any) => void) => onBotStreamBridge(callback),
  onFocusInput: (callback: () => void) => onFocusInputBridge(callback),
  suspendShortcut: () => ipcRenderer.invoke('suspend-shortcut'),
  resumeShortcut: () => ipcRenderer.invoke('resume-shortcut'),
  checkShortcut: (shortcut: string) => ipcRenderer.invoke('check-shortcut', shortcut)
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

