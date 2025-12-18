import { Routes, Route, useNavigate } from 'react-router-dom'
import InputView from './components/InputView'
import ChatView from './components/ChatView'
import ConfigView from './components/ConfigView'
import { useEffect } from 'react'

function App(): JSX.Element {
  const navigate = useNavigate()

  useEffect(() => {
    // Listen for navigation events from main process
    if (window.api && window.api.onNavigate) {
      window.api.onNavigate((route) => {
        console.log('Received navigate request:', route)
        navigate(route)
      })
    }
  }, [navigate])

  return (
    <Routes>
      <Route path="/input" element={<InputView />} />
      <Route path="/chat" element={<ChatView />} />
      <Route path="/config" element={<ConfigView />} />
      <Route path="/" element={<InputView />} /> {/* Default to input if no hash */}
    </Routes>
  )
}

export default App

