import './App.css'
import { AppRouter } from './router'
import { FloatNotePage } from './views/FloatNotePage'

function App() {
  if (window.location.hash.startsWith("#/float-note")) {
    return <FloatNotePage />
  }

  return <AppRouter />
}

export default App
