import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, OPENED_FROM_RECOVERY } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import AuthFrame from './AuthFrame'
import { useCooldown } from './Signup'

/**
 * "Password dimenticata?": /reset sends the recovery email (Supabase Auth); the email link comes back here
 * (redirectTo = <origin>/reset) already signed in, and the person chooses a new password.
 */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState(params.get('email') || '')
  const [sent, setSent] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [recovery, setRecovery] = useState(OPENED_FROM_RECOVERY)
  const cooldown = useCooldown(60)
  useEffect(() => { document.title = `Password dimenticata · ${BRAND}` }, [])
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((e) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  const send = async (e) => {
    e?.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset` })
    setBusy(false)
    if (error) return setMsg({ kind: 'danger', text: error.message })
    setSent(true); cooldown.start()
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setMsg({ kind: 'danger', text: error.message })
    nav('/', { replace: true })
  }

  if (recovery && loading) return <AuthFrame><div className="empty"><span className="spinner" aria-label="Caricamento" /></div></AuthFrame>
  if (recovery && session) {
    return (
      <AuthFrame>
        <h2>Nuova password</h2>
        <p className="secondary" style={{ margin: '10px 0 22px', fontWeight: 300 }}>Scegli la nuova password per {session.user.email}.</p>
        {msg && <div className={`callout ${msg.kind}`} role="alert" style={{ marginBottom: 16 }}>{msg.text}</div>}
        <form onSubmit={save}>
          <div className="field"><label className="label" htmlFor="rp-new">Nuova password</label>
            <input id="rp-new" className="input" type="password" required minLength={8} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="hint">Almeno 8 caratteri.</div></div>
          <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva la password'}</button>
        </form>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame>
      <h2>Password dimenticata?</h2>
      {sent ? (
        <>
          <div className="callout ok" role="status" style={{ margin: '14px 0 16px' }}>
            Se {email} ha un account, ti abbiamo mandato un link per scegliere una nuova password. Guarda anche in Spam.
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy || cooldown.left > 0} onClick={send}>
            {cooldown.left > 0 ? `Invia di nuovo tra ${cooldown.left} s` : 'Invia di nuovo'}
          </button>
        </>
      ) : (
        <form onSubmit={send}>
          <p className="secondary" style={{ margin: '10px 0 22px', fontWeight: 300 }}>Scrivi l’email del tuo account: ti mandiamo un link per sceglierne una nuova.</p>
          {msg && <div className={`callout ${msg.kind}`} role="alert" style={{ marginBottom: 16 }}>{msg.text}</div>}
          <div className="field"><label className="label" htmlFor="rp-mail">Email</label>
            <input id="rp-mail" className="input" type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy}>{busy ? 'Invio…' : 'Mandami il link'}</button>
        </form>
      )}
      <p className="hint" style={{ marginTop: 16 }}><Link to="/login">Torna all’accesso</Link></p>
    </AuthFrame>
  )
}
