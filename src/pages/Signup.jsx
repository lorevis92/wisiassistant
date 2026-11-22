import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, callFunction } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import AuthFrame from './AuthFrame'

/** Reads the global switch wa_settings.public_signup (off by default: access by invitation only). */
export function usePublicSignup() {
  const [on, setOn] = useState(null)
  useEffect(() => {
    supabase.from('wa_settings').select('value').eq('key', 'public_signup').maybeSingle()
      .then(({ data, error }) => setOn(!error && data?.value === true))
  }, [])
  return on
}

/**
 * Creates an organization owned by the signed-in user. Only on explicit click, only when public_signup is on and the
 * email is verified (the database function wa_signup_create_org checks all of it).
 */
export function CreateOrgForm() {
  const [name, setName] = useState('')
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
    await refresh(); nav('/', { replace: true })
  }
  return (
    <form onSubmit={submit}>
      <div className="field"><label className="label" htmlFor="org-new">Nome della tua organizzazione</label>
        <input id="org-new" className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Agenzia Rossi" /></div>
      {err && <div className="callout danger" role="alert" style={{ marginBottom: 14 }}>{err}</div>}
      <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creazione…' : 'Crea organizzazione'}</button>
    </form>
  )
}

/** Countdown for "send again" buttons. */
export function useCooldown(seconds = 60) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!left) return
    const t = setTimeout(() => setLeft((n) => Math.max(0, n - 1)), 1000)
    return () => clearTimeout(t)
  }, [left])
  return { left, start: () => setLeft(seconds) }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Asks the check-email function (server side, rate limited) whether the address already has an account.
 * Returns true / false, or null when the check is not available (function not deployed, too many requests).
 */
async function emailHasAccount(email) {
  try { const r = await callFunction('check-email', { email }); return r.exists === true } catch { return null }
}

/**
 * Registration page, only when public_signup is on. It creates the account only: after confirming the email and
 * signing in, the person sees their invitations and, if they want, "Crea la tua organizzazione".
 * An address that already has an account is caught before signing up (check-email) with "Accedi" and
 * "Password dimenticata?" instead of a silent no-op.
 */
export default function Signup() {
  const on = usePublicSignup()
  const { session } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [check, setCheck] = useState({ email: '', state: null }) // state: checking | exists | free | unknown
  const [done, setDone] = useState(null) // email the confirmation was sent to
  const cooldown = useCooldown(60)
  const timer = useRef(null)
  useEffect(() => { document.title = `Registrati · ${BRAND}` }, [])
  useEffect(() => { if (session) nav('/', { replace: true }) }, [session, nav])

  const runCheck = async (raw) => {
    const email = raw.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return null
    if (check.email === email && check.state && check.state !== 'checking') return check.state
    setCheck({ email, state: 'checking' })
    const r = await emailHasAccount(email)
    const state = r === true ? 'exists' : r === false ? 'free' : 'unknown'
    setCheck((c) => (c.email === email ? { email, state } : c))
    return state
  }
  const onEmail = (v) => {
    setF({ ...f, email: v }); setMsg(null)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => runCheck(v), 700) // while typing, after a short pause
  }

  const signUp = async (email) => {
    const { error } = await supabase.auth.signUp({ email, password: f.password, options: { emailRedirectTo: `${window.location.origin}/` } })
    if (error) { setMsg({ kind: 'danger', text: error.message }); return false }
    return true
  }
  const submit = async (e) => {
    e.preventDefault()
    const email = f.email.trim().toLowerCase()
    setBusy(true); setMsg(null)
    const state = await runCheck(email)
    if (state === 'exists') { setBusy(false); return } // never send a sign-up for an existing account
    const ok = await signUp(email)
    setBusy(false)
    if (ok) { setDone(email); cooldown.start() }
  }
  const resend = async () => {
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email: done, options: { emailRedirectTo: `${window.location.origin}/` } })
    setBusy(false)
    if (error) return setMsg({ kind: 'danger', text: error.message })
    setMsg({ kind: 'ok', text: 'Email inviata di nuovo.' }); cooldown.start()
  }

  if (on === null) return <AuthFrame><div className="empty"><span className="spinner" aria-label="Caricamento" /></div></AuthFrame>
  if (!on) {
    return (
      <AuthFrame>
        <h2>Accesso su invito</h2>
        <p className="secondary">Per ora {BRAND} si usa solo su invito. Se hai ricevuto un’email d’invito, segui il link che contiene.</p>
        <Link className="btn" to="/login">Vai all’accesso</Link>
      </AuthFrame>
    )
  }
  if (done) {
    return (
      <AuthFrame>
        <h2>Controlla la tua email</h2>
        <div className="callout ok" role="status" style={{ margin: '14px 0 16px' }}>
          Ti abbiamo mandato un link di conferma a <b style={{ color: 'var(--heading)' }}>{done}</b> (guarda anche in Spam). Aprilo, poi accedi.
        </div>
        {msg && <div className={`callout ${msg.kind}`} role={msg.kind === 'danger' ? 'alert' : 'status'} style={{ marginBottom: 14 }}>{msg.text}</div>}
        <button className="btn" style={{ width: '100%', marginBottom: 10 }} disabled={busy || cooldown.left > 0} onClick={resend}>
          {cooldown.left > 0 ? `Non è arrivata? Invia di nuovo tra ${cooldown.left} s` : 'Non è arrivata? Invia di nuovo'}
        </button>
        <Link className="btn ghost" style={{ width: '100%' }} to="/login">Vai all’accesso</Link>
      </AuthFrame>
    )
  }
  const exists = check.state === 'exists' && check.email === f.email.trim().toLowerCase()
  return (
    <AuthFrame>
      <h2>Registrati</h2>
      <p className="secondary" style={{ margin: '10px 0 22px', fontWeight: 300 }}>Dopo la conferma dell’email potrai accettare gli inviti ricevuti o creare la tua organizzazione.</p>
      {msg && <div className={`callout ${msg.kind}`} role={msg.kind === 'danger' ? 'alert' : 'status'} style={{ marginBottom: 16 }}>{msg.text}</div>}
      <form onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="su-mail">Email</label>
          <input id="su-mail" className="input" type="email" required autoComplete="email" value={f.email}
            onChange={(e) => onEmail(e.target.value)} onBlur={(e) => { clearTimeout(timer.current); runCheck(e.target.value) }} aria-describedby="su-mail-state" />
          <div id="su-mail-state" aria-live="polite">
            {check.state === 'checking' && check.email === f.email.trim().toLowerCase() && <div className="hint">Controllo dell’email…</div>}
          </div>
        </div>
        {exists ? (
          <div className="callout warn" role="alert" style={{ marginBottom: 16 }}>
            <b style={{ color: 'var(--heading)' }}>Questa email ha già un account.</b>
            <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
              <Link className="btn sm primary" to="/login" state={{ email: f.email.trim() }}>Accedi</Link>
              <Link className="btn sm" to={`/reset?email=${encodeURIComponent(f.email.trim())}`}>Password dimenticata?</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="field"><label className="label" htmlFor="su-pass">Password</label><input id="su-pass" className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              <div className="hint">Almeno 8 caratteri.</div></div>
            <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy || check.state === 'checking'}>{busy ? 'Un momento…' : 'Registrati'}</button>
          </>
        )}
      </form>
      <p className="hint" style={{ marginTop: 16 }}>Hai già un account? <Link to="/login">Accedi</Link></p>
    </AuthFrame>
  )
}
