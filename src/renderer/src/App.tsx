import { Routes, Route, useNavigate } from 'react-router-dom'
import InputView from './components/InputView'
import ChatView from './components/ChatView'
import OnboardingView from './components/OnboardingView'
import ConfigView from './components/ConfigView'
import ProfileView from './components/ProfileView'
import AboutView from './components/AboutView'
import PortfolioView from './components/PortfolioView'
import NewsView from './components/NewsView'
import StockDetailView from './components/StockDetailView'
import ToastView from './components/ToastView'
import UpdateToastView from './components/UpdateToastView'
import QuitConfirmModal from './components/QuitConfirmModal'
import { handleDocumentLinkClick } from './components/ExternalLink'
import { useEffect, useState } from 'react'

function App(): JSX.Element {
  const navigate = useNavigate()
  const [showQuitConfirm, setShowQuitConfirm] = useState(false)

  useEffect(() => {
    // Listen for navigation events from main process
    const removeNavigateListener = window.api?.onNavigate
      ? window.api.onNavigate((route) => {
          console.log('Received navigate request:', route)
          navigate(route)
        })
      : undefined

    // Listen for quit confirmation request from main process
    const removeQuitConfirmListener = window.api?.onQuitConfirm
      ? window.api.onQuitConfirm(() => {
          console.log('[App] Received quit confirmation request')
          setShowQuitConfirm(true)
        })
      : undefined

    document.addEventListener('click', handleDocumentLinkClick, true)

    return () => {
      removeNavigateListener?.()
      removeQuitConfirmListener?.()
      document.removeEventListener('click', handleDocumentLinkClick, true)
    }
  }, [navigate])

  const handleQuitConfirm = () => {
    console.log('[App] User confirmed quit')
    setShowQuitConfirm(false)
    if (window.api && window.api.quitConfirmed) {
      window.api.quitConfirmed(true)
    }
  }

  const handleQuitCancel = () => {
    console.log('[App] User cancelled quit')
    setShowQuitConfirm(false)
    if (window.api && window.api.quitConfirmed) {
      window.api.quitConfirmed(false)
    }
  }

  return (
    <>
      <Routes>
        <Route path="/input" element={<InputView />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/onboarding" element={<OnboardingView />} />
        <Route path="/config" element={<ConfigView />} />
        <Route path="/profile" element={<ProfileView />} />
        <Route path="/about" element={<AboutView />} />
        <Route path="/portfolio" element={<PortfolioView />} />
        <Route path="/news" element={<NewsView />} />
        <Route path="/stock/:tsCode" element={<StockDetailView />} />
        <Route path="/toast" element={<ToastView />} />
        <Route path="/update-toast" element={<UpdateToastView />} />
        <Route path="/" element={<InputView />} /> {/* Default to input if no hash */}
      </Routes>
      <QuitConfirmModal
        isOpen={showQuitConfirm}
        onConfirm={handleQuitConfirm}
        onCancel={handleQuitCancel}
      />
    </>
  )
}

export default App

