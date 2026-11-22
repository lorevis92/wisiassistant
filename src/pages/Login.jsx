import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import { Logo, Mark, ThemeSwitch } from '../components/Brand'

/** Stepped-diamond band, after the geometry of Sardinian hand weaving (abstract, no specific motif). */
function WeaveBand() {
  const steps = [[0, 4], [4, 12], [8, 20], [12, 12], [16, 4]]
  return (
    <svg className="weave" viewBox="0 0 280 28" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="sd-weave" width="28" height="28" patternUnits="userSpaceOnUse">
          {steps.map(([y, w]) => <rect key={y} x={14 - w / 2} y={y + 4} width={w} height="4" fill="currentColor" />)}
          <rect x="12" y="12" width="4" height="4" fill="var(--weave-dot)" />
          <rect x="0" y="0" width="2" height="2" fill="currentColor" opacity=".5" />
          <rect x="26" y="26" width="2" height="2" fill="currentColor" opacity=".5" />
        </pattern>
      </defs>
      <rect width="280" height="28" fill="url(#sd-weave)" />
    </svg>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const { session, denied } = useAuth()

  // navigate only once AuthProvider has confirmed the user is in wa_admins
  useEffect(() => { if (session) nav('/') }, [session, nav])
  useEffect(() => { document.title = `Accedi · ${BRAND}` }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setErr(error.message === 'Invalid login credentials' ? 'Email o password non corrette.' : error.message)
  }

  return (
    <div className="login">
      <section className="login-hero">
        <div className="login-hero-top"><Logo size={30} /></div>
        <div className="login-tower"><Mark size={340} className="tower" light="var(--weave-dot)" /></div>
        <div className="login-copy">
          <h1>Il tuo sito risponde ai clienti, anche quando sei chiuso.</h1>
          <p>{BRAND} legge pagine e documenti di ogni cliente e risponde ai visitatori sul sito, su Telegram e su WhatsApp, con i link giusti.</p>
        </div>
        <WeaveBand />
      </section>

      <section className="login-panel">
        <div className="login-panel-top">
          <span className="login-mobile-logo"><Logo /></span>
          <ThemeSwitch />
        </div>
        <form className="login-form" onSubmit={submit}>
          <h2>Accedi</h2>
          <p className="secondary" style={{ margin: '6px 0 26px' }}>Pannello di gestione di {BRAND}.</p>
          <div className="field">
            <label className="label" htmlFor="login-email">Email</label>
            <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="label" htmlFor="login-password">Password</label>
            <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {(err || denied) && <div className="callout danger" role="alert" style={{ marginBottom: 16 }}>{err || 'Questo account non ha accesso al pannello.'}</div>}
          <button className="btn primary" disabled={busy} style={{ width: '100%', padding: '12px 16px', fontSize: 15 }}>{busy ? 'Accesso in corso…' : 'Accedi'}</button>
          <p className="hint" style={{ marginTop: 18 }}>L’accesso è riservato agli amministratori abilitati.</p>
        </form>
      </section>

      <style>{`
.login { min-height: 100%; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(380px, 1fr); background: var(--bg); }
.login-hero {
  --weave-dot: #F07A62;
  position: relative; overflow: hidden; color: #E9F3F5; padding: 36px 48px 0; display: flex; flex-direction: column;
  background: radial-gradient(120% 80% at 85% 10%, #156C93 0%, transparent 60%), linear-gradient(170deg, #0D4B6B 0%, #08324A 55%, #062638 100%);
}
:root[data-theme="dark"] .login-hero { background: radial-gradient(120% 80% at 85% 10%, #0F4D68 0%, transparent 60%), linear-gradient(170deg, #0B2E40 0%, #071C28 60%, #051520 100%); border-right: 1px solid var(--border); }
.login-hero .brand { color: #fff; }
.login-hero .brand .mark circle { fill: #F07A62; }
.login-tower { position: absolute; right: -40px; top: 50%; transform: translateY(-58%); color: rgba(255,255,255,0.06); pointer-events: none; }
.login-tower .tower { display: block; }
.login-tower .tower circle { opacity: .55; }
.login-copy { margin-top: auto; margin-bottom: 44px; max-width: 34rem; position: relative; }
.login-copy h1 { color: #fff; font-size: clamp(32px, 3.5vw, var(--fs-hero)); font-weight: 600; line-height: 1.04; letter-spacing: -0.035em; font-variation-settings: 'opsz' 96; }
.login-copy p { color: rgba(233, 243, 245, 0.78); font-size: var(--fs-lg); line-height: 1.6; max-width: 48ch; margin: 18px 0 0; }
.login-hero .weave { display: block; height: 28px; width: calc(100% + 96px); margin: 0 -48px; color: rgba(140, 205, 222, 0.32); }
.login-panel { display: flex; flex-direction: column; padding: 28px 32px; }
.login-panel-top { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.login-mobile-logo { display: none; margin-right: auto; }
.login-form { width: 100%; max-width: 380px; margin: auto; padding: 40px 0; animation: sd-rise .5s var(--ease) both; }
.login-form h2 { font-size: var(--fs-h1); }
@media (max-width: 880px) {
  .login { grid-template-columns: 1fr; }
  .login-hero { display: none; }
  .login-mobile-logo { display: inline-flex; }
  .login-panel { padding: 20px 16px; }
}
      `}</style>
    </div>
  )
}
