import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { CapturePage } from './views/CapturePage'
import { HomePage } from './views/HomePage'
import { NotesPage } from './views/NotesPage'
import { RouteErrorPage } from './views/RouteErrorPage'
import { SearchPage } from './views/SearchPage'
import { SettingsPage } from './views/SettingsPage'
import { SourcesPage } from './views/SourcesPage'

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <HomePage /> },
      { path: 'capture', element: <CapturePage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'settings', element: <SettingsPage /> }
    ]
  }
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
