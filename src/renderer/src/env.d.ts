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
}

declare interface Window {
  api: {
    submitInput: (text: string) => void
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
    onFocusInput: (callback: () => void) => () => void
    onNavigate: (callback: (route: string) => void) => void
    suspendShortcut: () => Promise<void>
    resumeShortcut: () => Promise<void>
    checkShortcut: (shortcut: string) => Promise<boolean>
  }
}
