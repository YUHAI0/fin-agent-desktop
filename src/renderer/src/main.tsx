import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { HashRouter } from 'react-router-dom'
import { ChatProvider } from './contexts/ChatContext'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <HashRouter>
    <ChatProvider>
      <App />
    </ChatProvider>
  </HashRouter>
)

