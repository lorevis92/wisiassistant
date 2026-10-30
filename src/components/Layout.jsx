import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export function Navbar() {
  const { session } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const tabs = [
    { to: '/', label: 'Clienti' },
    { to: '/inbox', label: 'Inbox' },
    { to: '/reports', label: 'Report' },
  ]
  const isActive = (to) => (to === '/' ? loc.pathname === '/' || loc.pathname.startsWith('/clients') : loc.pathname.startsWith(to))

  return (
    <div className="navbar">
      <div className="navbar-inner">
        <button className="hamburger" onClick={() => nav('/')} aria-label="menu">☰</button>
        <Link to="/" className="brand">
          <img src="/logo-wisiassistant.png" alt="WISI" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <span className="name">Assistant</span>
        </Link>
        {session && (
          <div className="tabs">
            {tabs.map((t) => (
              <Link key={t.to} to={t.to} className={`tab ${isActive(t.to) ? 'active' : ''}`}>{t.label}</Link>
            ))}
          </div>
        )}
        <div className="nav-right">
          {session ? (
            <button className="btn ghost" onClick={async () => { await supabase.auth.signOut(); nav('/login') }}>Sign out</button>
          ) : (
            <Link to="/login" className="btn primary">Sign in</Link>
          )}
        </div>
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <div className="footer">
      <div className="footer-inner">
        <div className="row">
          <img src="/logo-wisiverse.png" alt="WiSiVERSE" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <span className="note">Part of the WiSiVERSE ecosystem</span>
        </div>
        <a className="link" href="https://wisiverse.com" target="_blank" rel="noopener">wisiverse.com →</a>
      </div>
    </div>
  )
}

export function Shell({ children }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Navbar />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer />
    </div>
  )
}
