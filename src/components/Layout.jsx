import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import { Logo, ThemeSwitch } from './Brand'

const Icon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const TABS = [
  { to: '/', label: 'Clienti', icon: <Icon d={<><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></>} /> },
  { to: '/inbox', label: 'Inbox', icon: <Icon d={<><path d="M3 13l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 13h5l1.5 3h5L16 13h5" /></>} /> },
  { to: '/reports', label: 'Report', icon: <Icon d={<><path d="M4 20V4M4 20h16" /><path d="M9 16v-4M14 16V8M19 16v-6" /></>} /> },
]

function useNav() {
  const loc = useLocation()
  const isActive = (to) => (to === '/' ? loc.pathname === '/' || loc.pathname.startsWith('/clients') : loc.pathname.startsWith(to))
  return isActive
}

function SignOut({ className = 'btn ghost sm' }) {
  const nav = useNavigate()
  return <button className={className} onClick={async () => { await supabase.auth.signOut(); nav('/login') }}>Esci</button>
}

/** Desktop: glass sidebar. Phone / tablet: top bar + horizontal section nav. */
export function Sidebar() {
  const { session } = useAuth()
  const isActive = useNav()
  return (
    <aside className="sidebar">
      <Link to="/" className="brand-link" aria-label={`${BRAND}, vai ai clienti`}><Logo /></Link>
      {session && (
        <nav className="sidenav" aria-label="Sezioni">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={() => (isActive(t.to) ? 'active' : '')} aria-current={isActive(t.to) ? 'page' : undefined}>{t.icon}{t.label}</NavLink>
          ))}
        </nav>
      )}
      <div className="sidebar-foot">
        <div className="row between"><span className="small muted">Tema</span><ThemeSwitch /></div>
        {session && <SignOut className="btn sm" />}
      </div>
    </aside>
  )
}

function Topbar() {
  const { session } = useAuth()
  const isActive = useNav()
  return (
    <>
      <header className="topbar">
        <Link to="/" aria-label={`${BRAND}, vai ai clienti`} style={{ display: 'inline-flex' }}><Logo size={26} /></Link>
        <div className="right"><ThemeSwitch />{session && <SignOut />}</div>
      </header>
      {session && (
        <nav className="mobilenav" aria-label="Sezioni">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} className={() => (isActive(t.to) ? 'active' : '')}>{t.label}</NavLink>)}
        </nav>
      )}
    </>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">© {new Date().getFullYear()} {BRAND}</div>
    </footer>
  )
}

export function Shell({ children, bare = false }) {
  if (bare) return children
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main style={{ flex: 1 }}>{children}</main>
        <Footer />
      </div>
    </div>
  )
}
