import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { HashRouter } from 'react-router-dom'
import { ChatProvider } from './contexts/ChatContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AppDialogProvider } from './contexts/AppDialogContext'

if (window.api?.platform) {
  document.documentElement.dataset.platform = window.api.platform
}
if (window.api?.windowBackdrop) {
  document.documentElement.dataset.windowBackdrop = window.api.windowBackdrop
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <HashRouter>
    <ThemeProvider>
      <AppDialogProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </AppDialogProvider>
    </ThemeProvider>
  </HashRouter>
)

