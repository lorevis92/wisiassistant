import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import ReceivedInvites from '../components/ReceivedInvites'
import AuthFrame from './AuthFrame'
import { CreateOrgForm, usePublicSignup } from './Signup'

/**
 * Signed in, but not a member of any organization. Shows the invitations received (accept / decline); when open
 * sign-up is on, also "Crea la tua organizzazione" (only that explicit click makes the person an owner).
 */
export default function NoAccess() {
  const { session, invites } = useAuth()
  const signup = usePublicSignup()
  const [create, setCreate] = useState(false)
  const verified = !!session?.user.email_confirmed_at
  return (
    <AuthFrame>
      <h2>Non fai parte di nessuna organizzazione</h2>
      <p className="secondary" style={{ margin: '10px 0 20px' }}>
        {invites.length
          ? `Hai ${invites.length === 1 ? 'un invito' : `${invites.length} inviti`}: accetta per entrare.`
          : signup ? 'Puoi chiedere un invito a chi usa già Sardesk, oppure creare la tua organizzazione.' : 'Per entrare serve un invito: chiedilo a un amministratore della tua organizzazione.'}
      </p>
      {!verified && <div className="callout warn" style={{ marginBottom: 16 }}>Conferma prima il tuo indirizzo {session?.user.email}: apri l’email di conferma che hai ricevuto.</div>}
      {invites.length > 0 && <div style={{ marginBottom: 18 }}><ReceivedInvites compact /></div>}
      {signup && (create
        ? <div style={{ marginBottom: 18 }}><CreateOrgForm /></div>
        : <button className="btn primary" style={{ width: '100%', marginBottom: 10 }} onClick={() => setCreate(true)}>Crea la tua organizzazione</button>)}
      <button className="btn" style={{ width: '100%' }} onClick={() => supabase.auth.signOut()}>Esci</button>
    </AuthFrame>
  )
}
