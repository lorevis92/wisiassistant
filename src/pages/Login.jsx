import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BRAND } from '../lib/brand'
import { Logo, Mark, ThemeSwitch } from '../components/Brand'

/** Stepped-diamond band after the geometry of Sardinian hand weaving, drawn as a thin neon line of motifs. */
function WeaveBand() {
  const steps = [[0, 4], [4, 12], [8, 20], [12, 12], [16, 4]]
  return (
    <svg className="weave" viewBox="0 0 280 28" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sd-weave-g" x1="0" x2="1">
          <stop offset="0" stopColor="#22E6D6" /><stop offset="1" stopColor="#8B6CFF" />
        </linearGradient>
        <pattern id="sd-weave" width="28" height="28" patternUnits="userSpaceOnUse">
          {steps.map(([y, w]) => <rect key={y} x={14 - w / 2} y={y + 4} width={w} height="4" fill="#fff" />)}
          <rect x="12" y="12" width="4" height="4" fill="#000" />
        </pattern>
        <mask id="sd-weave-m"><rect width="280" height="28" fill="url(#sd-weave)" /></mask>
      </defs>
      <rect width="280" height="28" fill="url(#sd-weave-g)" mask="url(#sd-weave-m)" />
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
        <div className="aurora a1" aria-hidden="true" />
        <div className="aurora a2" aria-hidden="true" />
        <div className="login-grid" aria-hidden="true" />
        <div className="login-hero-top"><Logo size={30} /></div>
        <div className="login-tower" aria-hidden="true"><Mark size={420} className="tower" /></div>
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
          <p className="secondary" style={{ margin: '10px 0 30px', fontWeight: 300 }}>Il pannello di gestione di {BRAND}.</p>
          <div className="field">
            <label className="label" htmlFor="login-email">Email</label>
            <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="label" htmlFor="login-password">Password</label>
            <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {(err || denied) && <div className="callout danger" role="alert" style={{ marginBottom: 16 }}>{err || 'Questo account non ha accesso al pannello.'}</div>}
          <button className="btn primary" disabled={busy} style={{ width: '100%', padding: '13px 16px', fontSize: 15 }}>{busy ? 'Accesso in corso…' : 'Accedi'}</button>
          <p className="hint" style={{ marginTop: 18 }}>L’accesso è riservato agli amministratori abilitati.</p>
        </form>
      </section>

      <style>{`
.login { min-height: 100%; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(400px, 1fr); }
.login-hero {
  position: relative; overflow: hidden; isolation: isolate; color: #E6EAF2; padding: 36px 52px 0; display: flex; flex-direction: column;
  background: #04060A; border-right: 1px solid rgba(160, 190, 255, 0.10);
}
.login-hero .brand { color: #fff; }
.aurora { position: absolute; border-radius: 50%; filter: blur(70px); z-index: -1; opacity: .85; animation: sd-drift 18s var(--ease) infinite alternate; }
.aurora.a1 { width: 520px; height: 420px; left: -120px; top: -140px; background: radial-gradient(circle, rgba(34, 230, 214, 0.55), transparent 65%); }
.aurora.a2 { width: 620px; height: 520px; right: -200px; bottom: 40px; background: radial-gradient(circle, rgba(139, 108, 255, 0.6), transparent 65%); animation-delay: -6s; }
@keyframes sd-drift { to { transform: translate(40px, 30px) scale(1.08); } }
.login-grid {
  position: absolute; inset: 0; z-index: -1; opacity: .5;
  background-image: radial-gradient(rgba(255, 255, 255, 0.09) 1px, transparent 1.2px); background-size: 26px 26px;
  -webkit-mask-image: radial-gradient(ellipse at 70% 40%, #000 0%, transparent 70%); mask-image: radial-gradient(ellipse at 70% 40%, #000 0%, transparent 70%);
}
.login-tower { position: absolute; right: -90px; top: 40%; transform: translateY(-50%); z-index: -1; opacity: .9; pointer-events: none;
  filter: drop-shadow(0 0 30px rgba(34, 230, 214, 0.45)) drop-shadow(0 0 70px rgba(139, 108, 255, 0.45)); }
.login-tower .tower circle { opacity: .7; }
.login-tower .tower { display: block; -webkit-mask-image: linear-gradient(180deg, #000 10%, transparent 95%); mask-image: linear-gradient(180deg, #000 10%, transparent 95%); }
.login-copy { margin-top: auto; margin-bottom: 48px; max-width: 36rem; position: relative; }
.login-copy h1 { color: #fff; font-size: clamp(32px, 3.6vw, var(--fs-hero)); font-weight: 600; line-height: 1.04; letter-spacing: -0.05em; text-wrap: balance; text-shadow: 0 0 40px rgba(0, 0, 0, 0.6); }
.login-copy p { color: rgba(230, 234, 242, 0.74); font-size: var(--fs-lg); font-weight: 300; line-height: 1.65; max-width: 48ch; margin: 20px 0 0; }
.login-hero .weave { display: block; height: 22px; width: calc(100% + 104px); margin: 0 -52px 18px; opacity: .75; }
.login-panel { display: flex; flex-direction: column; padding: 28px 36px; }
.login-panel-top { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.login-mobile-logo { display: none; margin-right: auto; }
.login-form { width: 100%; max-width: 380px; margin: auto; padding: 40px 0; animation: sd-rise .6s var(--ease) both; }
.login-form h2 { font-size: var(--fs-h1); }
@media (max-width: 900px) {
  .login { grid-template-columns: 1fr; }
  .login-hero { display: none; }
  .login-mobile-logo { display: inline-flex; }
  .login-panel { padding: 18px 16px; }
}
      `}</style>
    </div>
  )
}
