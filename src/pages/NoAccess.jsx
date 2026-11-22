import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import AuthFrame from './AuthFrame'
import { CreateOrgForm, PENDING_ORG_KEY, usePublicSignup } from './Signup'

/** Signed in but not part of any organization: explain, offer to create one when open sign-up is enabled. */
export default function NoAccess() {
  const { session } = useAuth()
  const signup = usePublicSignup()
  let pending = ''
  try { pending = localStorage.getItem(PENDING_ORG_KEY) || '' } catch { /* ignore */ }
  return (
    <AuthFrame>
      <h2>Nessuna organizzazione</h2>
      <p className="secondary" style={{ margin: '10px 0 20px' }}>
        L’account {session?.user.email} non fa parte di nessuna organizzazione. Per entrare serve un invito: chiedi a un amministratore il link.
      </p>
      {signup && <div style={{ marginBottom: 18 }}><CreateOrgForm initial={pending} /></div>}
      <button className="btn" style={{ width: '100%' }} onClick={() => supabase.auth.signOut()}>Esci</button>
    </AuthFrame>
  )
}
