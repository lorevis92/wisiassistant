import { useEffect, useState } from 'react'

export function Toast({ msg }) {
  if (!msg) return null
  return <div className="toast" role="status" aria-live="polite">{msg}</div>
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
    gone: ['red', 'Sparita'],
    excluded: ['muted', 'Esclusa'],
    done: ['green', 'Completato'],
    running: ['yellow', 'In corso'],
    queued: ['muted', 'In coda'],
    skipped: ['muted', 'Saltato'],
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
        <button className="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Nascondi' : 'Mostra'}</button>
      </div>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

export function Modal({ open, title, onClose, children, width = 560 }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost icon-only" aria-label="Chiudi" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ label = 'Caricamento…' }) {
  return <div className="empty" role="status"><span className="spinner" aria-hidden="true" /><div style={{ marginTop: 10 }}>{label}</div></div>
}

const GLYPHS = {
  chat: <path d="M6 9h20a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H15l-6 5v-5H6a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" />,
  doc: <path d="M9 4h11l7 7v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM20 4v7h7M12 18h10M12 23h7" />,
  inbox: <path d="M4 18l4-12h16l4 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 18h7l2 4h6l2-4h7" />,
  pages: <path d="M5 7h22M5 16h22M5 25h14" />,
  people: <path d="M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3 28c0-5 4-9 9-9s9 4 9 9M22 5.5a5 5 0 0 1 0 9.5M24 19c3 1 5 4.5 5 9" />,
  chart: <path d="M5 27V5M5 27h22M11 21v-6M17 21V10M23 21v-9" />,
}

/** Empty state: what is missing and what to do next. */
export function EmptyState({ icon = 'chat', title, children, action }) {
  return (
    <div className="empty-state">
      <svg className="glyph" width="40" height="40" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPHS[icon] || GLYPHS.chat}</svg>
      {title && <b>{title}</b>}
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  )
}
