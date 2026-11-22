import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Shell } from './components/Layout'
import Login from './pages/Login'
import Clients from './pages/Clients'
import ClientPage from './pages/client/ClientPage'
import Team from './pages/Team'
import Invite from './pages/Invite'
import Signup from './pages/Signup'
import NoAccess from './pages/NoAccess'
import Invites from './pages/Invites'
import Welcome from './pages/Welcome'
import ResetPassword from './pages/ResetPassword'
import Standalone from './pages/Standalone'

function Protected({ children }) {
  const { session, loading, denied } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="empty" style={{ paddingTop: '30vh' }}><span className="spinner" aria-label="Caricamento" /></div>
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (denied) return <NoAccess />
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Public standalone chat page: <APP_URL>/c/<slug> */}
      <Route path="/c/:slug" element={<Standalone />} />
      {/* Public: invitation link and (when enabled in wa_settings) open sign-up */}
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/signup" element={<Signup />} />
      {/* landing of the Supabase invitation email: choose a password (joining is automatic) */}
      <Route path="/welcome" element={<Welcome />} />
      {/* "Password dimenticata?": request the email, and landing of its link to choose a new password */}
      <Route path="/reset" element={<ResetPassword />} />

      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Shell><Clients /></Shell></Protected>} />
      <Route path="/clients/:id/*" element={<Protected><Shell><ClientPage /></Shell></Protected>} />
      <Route path="/team" element={<Protected><Shell><Team /></Shell></Protected>} />
      <Route path="/invites" element={<Protected><Shell><Invites /></Shell></Protected>} />
      {/* Inbox and Report live inside each client now */}
      <Route path="/inbox" element={<Navigate to="/" replace />} />
      <Route path="/reports" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
