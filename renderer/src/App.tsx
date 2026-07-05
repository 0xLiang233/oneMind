import './App.css'
import { useEffect } from 'react'
import { flushActivity } from './activity'
import { AppRouter } from './router'
import { FloatNotePage } from './views/FloatNotePage'

function App() {
  useEffect(() => {
    const handleBeforeUnload = () => {
      void flushActivity({ closeSessions: true })
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  if (window.location.hash.startsWith("#/float-note")) {
    return <FloatNotePage />
  }

  return <AppRouter />
}

export default App
