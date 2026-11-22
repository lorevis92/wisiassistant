import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth, ROLE_LABEL } from '../lib/auth'
import { BRAND } from '../lib/brand'
import { Logo, ThemeSwitch } from './Brand'

const Icon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const TABS = [
  { to: '/', label: 'Clienti', icon: <Icon d={<><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></>} /> },
  { to: '/team', label: 'Team', icon: <Icon d={<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 13.8c2.1.8 3.5 3 3.5 6.2" /></>} /> },
]
// Inbox and Report are per client (tabs in the client page): the global navigation holds only app-wide sections.

const INVITES_ICON = <Icon d={<><path d="M3 7l9 6 9-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></>} />

/** Navigation entries: "Inviti ricevuti" appears only while there are invitations to answer. */
function useTabs() {
  const { invites } = useAuth()
  return invites.length ? [...TABS, { to: '/invites', label: 'Inviti', icon: INVITES_ICON, count: invites.length }] : TABS
}

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
  const tabs = useTabs()
  return (
    <aside className="sidebar">
      <Link to="/" className="brand-link" aria-label={`${BRAND}, vai ai clienti`}><Logo /></Link>
      {session && (
        <nav className="sidenav" aria-label="Sezioni">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={() => (isActive(t.to) ? 'active' : '')} aria-current={isActive(t.to) ? 'page' : undefined}>
              {t.icon}{t.label}{t.count ? <span className="nav-count" aria-label={`${t.count} da rispondere`}>{t.count}</span> : null}
            </NavLink>
          ))}
        </nav>
      )}
      <div className="sidebar-foot">
        {session && <Account />}
        <div className="row between"><span className="small muted">Tema</span><ThemeSwitch /></div>
        {session && <SignOut className="btn sm" />}
      </div>
    </aside>
  )
}

/** Account: who is signed in, organization and role; organization switch when the user belongs to several. */
function Account() {
  const { session, memberships, org, role, selectOrg } = useAuth()
  return (
    <div className="account">
      <div className="account-org">
        {memberships.length > 1 ? (
          <select className="select" aria-label="Organizzazione" value={org?.id || ''} onChange={(e) => selectOrg(e.target.value)} style={{ padding: '6px 30px 6px 10px', fontSize: 13 }}>
            {memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.org.name}</option>)}
          </select>
        ) : <b>{org?.name || BRAND}</b>}
        {role && <span className="badge">{ROLE_LABEL[role]}</span>}
      </div>
      <div className="small muted account-mail" title={session.user.email}>{session.user.email}</div>
    </div>
  )
}

function Topbar() {
  const { session } = useAuth()
  const isActive = useNav()
  const tabs = useTabs()
  return (
    <>
      <header className="topbar">
        <Link to="/" aria-label={`${BRAND}, vai ai clienti`} style={{ display: 'inline-flex' }}><Logo size={26} /></Link>
        <div className="right"><ThemeSwitch />{session && <SignOut />}</div>
      </header>
      {session && (
        <nav className="mobilenav" aria-label="Sezioni">
          {tabs.map((t) => <NavLink key={t.to} to={t.to} className={() => (isActive(t.to) ? 'active' : '')}>{t.label}{t.count ? ` (${t.count})` : ''}</NavLink>)}
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

/** Shown right after sign-in while there are invitations to answer (dismissed for this visit). */
function InvitesBanner() {
  const { invites } = useAuth()
  const loc = useLocation()
  const [hidden, setHidden] = useState(false)
  if (!invites.length || hidden || loc.pathname === '/invites') return null
  return (
    <div className="invite-banner" role="status">
      <span>{invites.length === 1 ? `${invites[0].org_name} ti ha invitato a entrare nel team.` : `Hai ${invites.length} inviti da altre organizzazioni.`}</span>
      <span className="row" style={{ gap: 8 }}>
        <Link className="btn sm primary" to="/invites">Vedi {invites.length === 1 ? 'invito' : 'inviti'}</Link>
        <button className="btn sm ghost" aria-label="Nascondi" onClick={() => setHidden(true)}>Più tardi</button>
      </span>
    </div>
  )
}

export function Shell({ children, bare = false }) {
  if (bare) return children
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <InvitesBanner />
        <main style={{ flex: 1 }}>{children}</main>
        <Footer />
      </div>
    </div>
  )
}
