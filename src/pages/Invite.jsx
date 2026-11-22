import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth, ROLE_LABEL } from '../lib/auth'
import { BRAND } from '../lib/brand'
import AuthFrame from './AuthFrame'

/**
 * Invitation link: /invite/<token>. Shows who invites and with which role; the person creates an account (or signs in)
 * with the invited email, then joins. The database function wa_accept_invite checks token, expiry, single use and email.
 */
const STATUS_MSG = {
  not_found: 'Questo link d’invito non esiste o è stato sostituito da uno più recente.',
  used: 'Questo invito è già stato usato.',
  revoked: 'Questo invito è stato revocato.',
  expired: 'Questo invito è scaduto: chiedi a chi ti ha invitato un nuovo link.',
}

export default function Invite() {
  const { token } = useParams()
  const nav = useNavigate()
  const { session, refresh } = useAuth()
  const [info, setInfo] = useState(null)
  const [mode, setMode] = useState('signup') // signup | signin
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { kind: 'danger'|'ok', text }

  useEffect(() => {
    document.title = `Invito · ${BRAND}`
    supabase.rpc('wa_invite_info', { p_token: token }).then(({ data, error }) => setInfo(error ? { status: 'not_found' } : data))
  }, [token])

  const sameEmail = session && info?.email && session.user.email?.toLowerCase() === info.email.toLowerCase()

  const accept = async () => {
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('wa_accept_invite', { p_token: token })
    setBusy(false)
    if (error) return setMsg({ kind: 'danger', text: error.message })
    await refresh()
    nav('/', { replace: true })
  }

  const auth = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: info.email, password, options: { emailRedirectTo: window.location.href } })
      setBusy(false)
      if (error) return setMsg({ kind: 'danger', text: error.message })
      if (!data.session) setMsg({ kind: 'ok', text: `Ti abbiamo mandato un’email di conferma a ${info.email}. Aprila, poi torna su questo link per entrare. Se avevi già un account, scegli “Ho già un account”.` })
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: info.email, password })
      setBusy(false)
      if (error) return setMsg({ kind: 'danger', text: error.message === 'Invalid login credentials' ? 'Password non corretta.' : error.message })
    }
  }

  if (!info) return <AuthFrame><div className="empty"><span className="spinner" aria-label="Caricamento" /></div></AuthFrame>

  if (info.status !== 'valid') {
    return (
      <AuthFrame>
        <h2>Invito non valido</h2>
        <p className="secondary">{STATUS_MSG[info.status] || STATUS_MSG.not_found}</p>
        <Link className="btn" to="/login">Vai all’accesso</Link>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame>
      <h2 style={{ fontSize: 26 }}>Unisciti a {info.org_name}</h2>
      <p className="secondary" style={{ margin: '12px 0 22px', fontWeight: 300 }}>
        Sei stato invitato come <b style={{ color: 'var(--heading)' }}>{ROLE_LABEL[info.role]}</b>
        {info.role === 'collaborator' ? ` su ${info.client_count} ${info.client_count === 1 ? 'cliente' : 'clienti'}` : ''}.
        L’invito è per <b style={{ color: 'var(--heading)' }}>{info.email}</b>.
      </p>

      {msg && <div className={`callout ${msg.kind}`} role={msg.kind === 'danger' ? 'alert' : 'status'} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {session ? (
        sameEmail ? (
          <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy} onClick={accept}>{busy ? 'Un momento…' : `Entra in ${info.org_name}`}</button>
        ) : (
          <>
            <div className="callout warn" style={{ marginBottom: 14 }}>Sei collegato come {session.user.email}. Per accettare esci e accedi con {info.email}.</div>
            <button className="btn" style={{ width: '100%' }} onClick={() => supabase.auth.signOut()}>Esci</button>
          </>
        )
      ) : (
        <form onSubmit={auth}>
          <div className="tabs" role="radiogroup" aria-label="Account" style={{ marginBottom: 18 }}>
            {[['signup', 'Crea il tuo account'], ['signin', 'Ho già un account']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} className={`tab ${mode === k ? 'active' : ''}`} onClick={() => { setMode(k); setMsg(null) }}>{l}</button>
            ))}
          </div>
          <div className="field"><label className="label" htmlFor="inv-mail">Email</label><input id="inv-mail" className="input" value={info.email} readOnly /></div>
          <div className="field"><label className="label" htmlFor="inv-pass">{mode === 'signup' ? 'Scegli una password' : 'Password'}</label>
            <input id="inv-pass" className="input" type="password" required minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'signup' && <div className="hint">Almeno 8 caratteri.</div>}</div>
          <button className="btn primary" style={{ width: '100%', padding: '13px 16px' }} disabled={busy}>{busy ? 'Un momento…' : mode === 'signup' ? 'Crea account' : 'Accedi'}</button>
        </form>
      )}
    </AuthFrame>
  )
}
