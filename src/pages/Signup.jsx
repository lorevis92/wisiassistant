import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import AuthFrame from './AuthFrame'

export const PENDING_ORG_KEY = 'sardesk-pending-org'

/** Reads the global switch wa_settings.public_signup (off by default: sign-up only by invitation). */
export function usePublicSignup() {
  const [on, setOn] = useState(null)
  useEffect(() => {
    supabase.from('wa_settings').select('value').eq('key', 'public_signup').maybeSingle()
      .then(({ data, error }) => setOn(!error && data?.value === true))
  }, [])
  return on
}

/** Creates the organization of the signed-in user (they become its owner). Used after sign-up and from NoAccess. */
export function CreateOrgForm({ initial = '' }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { refresh } = useAuth()
  const nav = useNavigate()
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('wa_signup_create_org', { p_name: name.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    try { localStorage.removeItem(PENDING_ORG_KEY) } catch { /* ignore */ }
    await refresh(); nav('/', { replace: true })
  }
  return (
    <form onSubmit={submit}>
      <div className="field"><label className="label" htmlFor="org-new">Nome della tua organizzazione</label>
        <input id="org-new" className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Agenzia Rossi" /></div>
      {err && <div className="callout danger" role="alert" style={{ marginBottom: 14 }}>{err}</div>}
      <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creazione…' : 'Crea organizzazione'}</button>
    </form>
  )
}

/** Open sign-up (only when enabled): account + own organization as owner. */
export default function Signup() {
  const on = usePublicSignup()
  const { session } = useAuth()
  const [f, setF] = useState({ org: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { document.title = `Crea un account · ${BRAND}` }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try { localStorage.setItem(PENDING_ORG_KEY, f.org.trim()) } catch { /* ignore */ }
    const { data, error } = await supabase.auth.signUp({ email: f.email.trim(), password: f.password, options: { emailRedirectTo: `${window.location.origin}/` } })
    setBusy(false)
    if (error) return setMsg({ kind: 'danger', text: error.message })
    if (!data.session) setMsg({ kind: 'ok', text: `Ti abbiamo mandato un’email di conferma a ${f.email}. Aprila e accedi: creeremo l’organizzazione “${f.org}”.` })
  }

  if (on === null) return <AuthFrame><div className="empty"><span className="spinner" aria-label="Caricamento" /></div></AuthFrame>
  if (!on) {
    return (
      <AuthFrame>
        <h2>Solo su invito</h2>
        <p className="secondary">Per ora {BRAND} si usa solo su invito. Se hai ricevuto un link, aprilo per creare il tuo account.</p>
        <Link className="btn" to="/login">Vai all’accesso</Link>
      </AuthFrame>
    )
  }
  if (session) return <AuthFrame><h2 style={{ marginBottom: 16 }}>Crea la tua organizzazione</h2><CreateOrgForm initial={f.org} /></AuthFrame>
  return (
    <AuthFrame>
      <h2>Crea il tuo account</h2>
      <p className="secondary" style={{ margin: '10px 0 22px', fontWeight: 300 }}>Crei anche la tua organizzazione, di cui sarai owner.</p>
      {msg && <div className={`callout ${msg.kind}`} style={{ marginBottom: 16 }}>{msg.text}</div>}
      <form onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="su-org">Organizzazione</label><input id="su-org" className="input" required value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="su-mail">Email</label><input id="su-mail" className="input" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="su-pass">Password</label><input id="su-pass" className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy}>{busy ? 'Un momento…' : 'Crea account'}</button>
      </form>
      <p className="hint" style={{ marginTop: 16 }}>Hai già un account? <Link to="/login">Accedi</Link></p>
    </AuthFrame>
  )
}
