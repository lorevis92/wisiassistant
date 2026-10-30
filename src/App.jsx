import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Shell } from './components/Layout'
import Login from './pages/Login'
import Clients from './pages/Clients'
import ClientPage from './pages/client/ClientPage'
import Inbox from './pages/Inbox'
import Reports from './pages/Reports'
import Standalone from './pages/Standalone'

function Protected({ children }) {
  const { session, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="empty">Caricamento…</div>
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Public standalone chat page: assistant.wisiverse.com/c/<slug> */}
      <Route path="/c/:slug" element={<Standalone />} />

      <Route path="/login" element={<Shell><Login /></Shell>} />
      <Route path="/" element={<Protected><Shell><Clients /></Shell></Protected>} />
      <Route path="/clients/:id/*" element={<Protected><Shell><ClientPage /></Shell></Protected>} />
      <Route path="/inbox" element={<Protected><Shell><Inbox /></Shell></Protected>} />
      <Route path="/reports" element={<Protected><Shell><Reports /></Shell></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
