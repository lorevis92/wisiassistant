import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthCtx = createContext({ session: null, loading: true, denied: false })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let alive = true
    let checkedUser = null
    // Shared Supabase project: a session counts only if the user is in wa_admins, otherwise sign out.
    const apply = async (s) => {
      if (!s) { checkedUser = null; if (alive) { setSession(null); setLoading(false) } return }
      if (checkedUser === s.user.id) { if (alive) setSession(s); return }
      if (alive) setLoading(true)
      const { data: ok } = await supabase.rpc('wa_is_admin')
      if (!alive) return
      if (ok === true) { checkedUser = s.user.id; setDenied(false); setSession(s) }
      else { setDenied(true); setSession(null); await supabase.auth.signOut() }
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    // defer: supabase calls inside the auth callback can deadlock
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setTimeout(() => apply(s), 0) })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  return <AuthCtx.Provider value={{ session, loading, denied }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
