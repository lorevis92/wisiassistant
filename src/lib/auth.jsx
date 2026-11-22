import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Session + organization context.
 * Access is decided by the database (RLS, migration 0006): this context only drives what the UI shows.
 *  - memberships: [{ org_id, role: 'owner'|'admin'|'collaborator', org: { id, name, plan, limits } }]
 *  - org / role: the organization in use (remembered when there are several)
 *  - denied: signed in but not a member of any organization (shared Supabase project: users of other apps)
 *  - legacy: the 0006 migration has not been run yet → old model (wa_admins = full access)
 *  - invites: invitations received by this account (verified email) still to accept / decline (migration 0007)
 * On every sign-in wa_claim_invites() runs first: someone invited when they had no account joins automatically
 * (only with a verified email matching the invite; the database checks it).
 */
const ORG_KEY = 'sardesk-org'
const AuthCtx = createContext({ session: null, loading: true, denied: false, memberships: [], org: null, role: null, isOrgAdmin: false, legacy: false, invites: [], refresh: async () => {}, refreshInvites: async () => {}, selectOrg: () => {} })

const readOrg = () => { try { return localStorage.getItem(ORG_KEY) } catch { return null } }

async function loadMemberships(userId) {
  const { data, error } = await supabase.from('wa_org_members').select('org_id, role, org:wa_organizations(id, name, plan, limits)').eq('user_id', userId)
  if (!error) return { memberships: (data || []).filter((m) => m.org), legacy: false }
  // table not there yet (migration 0006 not run): fall back to the old admin check so nobody is locked out
  const { data: ok } = await supabase.rpc('wa_is_admin')
  return { memberships: ok === true ? [{ org_id: null, role: 'owner', org: { id: null, name: 'Sardesk', plan: 'internal', limits: {} } }] : [], legacy: true }
}

async function loadInvites() {
  const { data, error } = await supabase.rpc('wa_my_invites')
  return error || !Array.isArray(data) ? [] : data
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState([])
  const [legacy, setLegacy] = useState(false)
  const [orgId, setOrgId] = useState(readOrg)
  const [invites, setInvites] = useState([])

  const apply = useCallback(async (s) => {
    if (!s) { setSession(null); setMemberships([]); setInvites([]); setLoading(false); return }
    setLoading(true)
    await supabase.rpc('wa_claim_invites').then(() => {}, () => {}) // automatic join for invited new accounts (0007)
    const [r, inv] = await Promise.all([loadMemberships(s.user.id), loadInvites()])
    setMemberships(r.memberships); setLegacy(r.legacy); setInvites(inv); setSession(s); setLoading(false)
  }, [])

  useEffect(() => {
    let alive = true
    let lastUser
    supabase.auth.getSession().then(({ data }) => { if (alive) { lastUser = data.session?.user.id; apply(data.session) } })
    // defer: supabase calls inside the auth callback can deadlock. Token refreshes keep the loaded memberships.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => {
        if (!alive) return
        if (s && s.user.id === lastUser) { setSession(s); return }
        lastUser = s?.user.id
        apply(s)
      }, 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [apply])

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await apply(data.session)
  }, [apply])

  const refreshInvites = useCallback(async () => setInvites(await loadInvites()), [])

  const selectOrg = (id) => { try { localStorage.setItem(ORG_KEY, id) } catch { /* ignore */ } setOrgId(id) }

  const current = memberships.find((m) => m.org_id === orgId) || memberships[0] || null
  const value = {
    session, loading, memberships, legacy, refresh, selectOrg, invites, refreshInvites,
    denied: !!session && !loading && memberships.length === 0,
    org: current?.org || null,
    role: current?.role || null,
    isOrgAdmin: current?.role === 'owner' || current?.role === 'admin',
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', collaborator: 'Collaboratore' }
