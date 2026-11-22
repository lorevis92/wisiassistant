import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import { Logo, ThemeSwitch } from './Brand'

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
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" aria-label={`${BRAND}, vai ai clienti`} style={{ display: 'inline-flex' }}><Logo /></Link>
        {session && (
          <nav className="mainnav" aria-label="Sezioni">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} className={() => (isActive(t.to) ? 'active' : '')} aria-current={isActive(t.to) ? 'page' : undefined}>{t.label}</NavLink>
            ))}
          </nav>
        )}
        <div className="nav-right">
          <ThemeSwitch />
          {session && (
            <button className="btn ghost sm" onClick={async () => { await supabase.auth.signOut(); nav('/login') }}>Esci</button>
          )}
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>© {new Date().getFullYear()} {BRAND}</span>
      </div>
    </footer>
  )
}

export function Shell({ children, bare = false }) {
  if (bare) return children
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Navbar />
      <main style={{ flex: 1 }}>{children}</main>
      <Footer />
    </div>
  )
}
