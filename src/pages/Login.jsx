import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setErr(error.message)
    nav('/')
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <div className="card" style={{ marginTop: 60 }}>
        <h2 style={{ marginBottom: 6 }}>Accesso amministratore</h2>
        <p className="secondary small" style={{ marginBottom: 20 }}>WISI Assistant · pannello di controllo</p>
        <form onSubmit={submit}>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {err && <div className="badge red" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Accesso…' : 'Entra'}</button>
        </form>
        <p className="hint" style={{ marginTop: 14 }}>L’utente admin si crea una sola volta da Supabase → Authentication → Users.</p>
      </div>
    </div>
  )
}
