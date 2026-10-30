import { useEffect, useState } from 'react'

export function Toast({ msg }) {
  if (!msg) return null
  return <div className="toast">{msg}</div>
}

export function useToast() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 2600)
    return () => clearTimeout(t)
  }, [msg])
  return [msg, setMsg]
}

export function Stat({ k, v, s }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  )
}

export function StatusBadge({ status }) {
  const map = {
    ready: ['green', 'Pronto'],
    crawling: ['yellow', 'Crawling'],
    mapping: ['yellow', 'Mapping'],
    indexing: ['yellow', 'Indicizzazione'],
    error: ['red', 'Errore'],
    new: ['muted', 'Nuovo'],
    paused: ['muted', 'In pausa'],
    ok: ['green', 'OK'],
    pending: ['muted', 'In attesa'],
    failed: ['red', 'Errore'],
    empty: ['yellow', 'Vuota'],
    draft: ['yellow', 'Bozza'],
    approved: ['green', 'Approvato'],
    sent: ['green', 'Inviato'],
    open: ['green', 'Aperta'],
    resolved: ['muted', 'Risolta'],
    escalated: ['red', 'Escalation'],
    human: ['yellow', 'Umano'],
  }
  const [cls, label] = map[status] || ['muted', status || '—']
  return <span className={`badge ${cls}`}>{label}</span>
}

export function Collapsible({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="section">
      <div className="row between">
        <span className="section-label">{label}</span>
        <button className="section-toggle" onClick={() => setOpen(!open)}>{open ? 'CLOSE ▲' : 'SHOW ▼'}</button>
      </div>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

export function Modal({ open, title, onClose, children, width = 560 }) {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <h3>{title}</h3>
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ label = 'Caricamento…' }) {
  return <div className="empty">{label}</div>
}
