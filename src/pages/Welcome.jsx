import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import AuthFrame from './AuthFrame'

/**
 * Landing page of the Supabase invitation email (redirectTo = <APP_URL>/welcome). Following that link verifies the
 * email and signs the person in; here they choose a password. Joining the organization is automatic
 * (wa_claim_invites runs at sign-in in AuthProvider).
 */
export default function Welcome() {
  const { session, loading, memberships, refresh } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const nav = useNavigate()
  useEffect(() => { document.title = `Benvenuto · ${BRAND}` }, [])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setErr(error.message)
    await refresh()
    nav('/', { replace: true })
  }

  if (loading) return <AuthFrame><div className="empty"><span className="spinner" aria-label="Caricamento" /></div></AuthFrame>
  if (!session) {
    return (
      <AuthFrame>
        <h2>Link non valido</h2>
        <p className="secondary">Il link è scaduto o è già stato usato. Se hai già scelto la password, accedi; altrimenti chiedi un nuovo invito.</p>
        <Link className="btn" to="/login">Vai all’accesso</Link>
      </AuthFrame>
    )
  }
  const org = memberships[0]?.org?.name
  return (
    <AuthFrame>
      <h2 style={{ fontSize: 26 }}>Benvenuto in {org || BRAND}</h2>
      <p className="secondary" style={{ margin: '12px 0 22px', fontWeight: 300 }}>
        La tua email {session.user.email} è confermata{org ? ` e sei già nel team di ${org}` : ''}. Scegli una password per i prossimi accessi.
      </p>
      <form onSubmit={save}>
        <div className="field"><label className="label" htmlFor="wl-pass">Password</label>
          <input id="wl-pass" className="input" type="password" required minLength={8} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="hint">Almeno 8 caratteri.</div></div>
        {err && <div className="callout danger" role="alert" style={{ marginBottom: 14 }}>{err}</div>}
        <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva e continua'}</button>
      </form>
    </AuthFrame>
  )
}
