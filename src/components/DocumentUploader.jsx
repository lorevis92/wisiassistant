import { useEffect, useRef, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'

export const DOC_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'] // formats the `ingest` function can read
export const DOC_MAX_MB = 20 // per file: larger files are slow / heavy to parse in the edge function
const CONCURRENCY = 2 // files uploaded + indexed at the same time (keeps the edge function light)

const STATUS = {
  ready: ['muted', 'Pronto'],
  queued: ['muted', 'In coda'],
  uploading: ['yellow', 'Caricamento…'],
  indexing: ['yellow', 'Indicizzazione…'],
  done: ['green', 'Completato'],
  error: ['red', 'Errore'],
}

const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

/**
 * Multi-file document upload with drag & drop: files are validated (format, size, empty, duplicates), listed with
 * name/size for review, then uploaded to the wa-documents bucket and indexed by the `ingest` function,
 * CONCURRENCY at a time. One file failing never stops the others; a summary is shown at the end.
 */
export default function DocumentUploader({ clientId, onUploaded }) {
  const [items, setItems] = useState([]) // { id, file, status, error }
  const [rejected, setRejected] = useState([]) // { name, reason }
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState(null) // { ok, failed: [{name, error}] }
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)
  const depth = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  // a file dropped outside the drop area must not make the browser open it (and leave the dashboard)
  useEffect(() => {
    const stop = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])

  const addFiles = (list) => {
    const files = Array.from(list || [])
    if (!files.length) return
    const known = new Set(itemsRef.current.filter((i) => i.status !== 'done').map((i) => `${i.file.name}|${i.file.size}`))
    const ok = [], bad = []
    for (const f of files) {
      const key = `${f.name}|${f.size}`
      if (!DOC_EXTENSIONS.includes(extOf(f.name))) bad.push({ name: f.name, reason: `formato non supportato (usa ${DOC_EXTENSIONS.map((e) => e.toUpperCase()).join(', ')})` })
      else if (f.size === 0) bad.push({ name: f.name, reason: 'file vuoto' })
      else if (f.size > DOC_MAX_MB * 1024 * 1024) bad.push({ name: f.name, reason: `troppo grande (${fmtSize(f.size)}, massimo ${DOC_MAX_MB} MB)` })
      else if (known.has(key)) bad.push({ name: f.name, reason: 'già nell’elenco' })
      else { known.add(key); ok.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, status: 'ready', error: null }) }
    }
    setRejected(bad)
    if (ok.length) { setSummary(null); setItems((prev) => [...prev.filter((i) => i.status !== 'done'), ...ok]) }
  }

  const update = (id, patch) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const remove = (id) => setItems((prev) => prev.filter((i) => i.id !== id))

  const processOne = async (item) => {
    const f = item.file
    try {
      update(item.id, { status: 'uploading', error: null })
      const path = `${clientId}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage.from('wa-documents').upload(path, f, { upsert: false, contentType: f.type || undefined })
      if (error) throw error
      update(item.id, { status: 'indexing' })
      await callFunction('ingest', { client_id: clientId, kind: 'document', storage_path: path, title: f.name })
      update(item.id, { status: 'done' })
      onUploaded?.()
      return { ok: true }
    } catch (e) {
      const msg = e?.message || 'errore sconosciuto'
      update(item.id, { status: 'error', error: msg })
      return { ok: false, name: f.name, error: msg }
    }
  }

  const start = async (only) => {
    const batch = itemsRef.current.filter((i) => (only ? only.includes(i.id) : i.status === 'ready' || i.status === 'error'))
    if (!batch.length || running) return
    setRunning(true); setSummary(null); setRejected([])
    setItems((prev) => prev.map((i) => (batch.some((b) => b.id === i.id) ? { ...i, status: 'queued', error: null } : i)))
    const queue = [...batch]
    const results = []
    const worker = async () => {
      while (queue.length) {
        const next = queue.shift()
        // removed from the list while waiting in the queue → skip it
        if (!itemsRef.current.some((i) => i.id === next.id)) continue
        results.push(await processOne(next))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker))
    setSummary({ ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) })
    setRunning(false)
  }

  const onDrop = (e) => {
    e.preventDefault(); depth.current = 0; setOver(false)
    addFiles(e.dataTransfer?.files)
  }
  const dragIn = (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); depth.current++; setOver(true) }
  const dragOut = () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) }

  const ready = items.filter((i) => i.status === 'ready').length
  const failed = items.filter((i) => i.status === 'error').length
  const finished = items.filter((i) => i.status === 'done' || i.status === 'error').length
  const active = items.filter((i) => i.status !== 'ready').length

  return (
    <div className="col" style={{ gap: 12 }}>
      <div
        role="button" tabIndex={0} aria-label="Trascina qui i documenti oppure premi per sceglierli"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragEnter={dragIn} onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
        onDragLeave={dragOut} onDrop={onDrop}
        style={{
          border: `2px dashed ${over ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, padding: '26px 16px', textAlign: 'center', cursor: 'pointer',
          background: over ? 'var(--primaryBg, rgba(232,53,42,0.06))' : 'var(--surfaceAlt, #fafafa)', transition: 'border-color .15s, background .15s',
        }}>
        <div style={{ fontSize: 26, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">{over ? '⬇' : '📄'}</div>
        <div style={{ fontWeight: 600 }}>{over ? 'Rilascia i file per aggiungerli' : 'Trascina qui i documenti oppure clicca per sceglierli'}</div>
        <div className="small secondary" style={{ marginTop: 4 }}>
          {DOC_EXTENSIONS.map((e) => e.toUpperCase()).join(', ')} · massimo {DOC_MAX_MB} MB per file · più file insieme
        </div>
        <input ref={inputRef} type="file" multiple hidden accept={DOC_EXTENSIONS.map((e) => `.${e}`).join(',')}
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      </div>

      {rejected.length > 0 && (
        <div className="card tight" style={{ borderColor: 'var(--primary)' }} role="alert">
          <div className="row between">
            <b className="small">{rejected.length === 1 ? '1 file scartato' : `${rejected.length} file scartati`}</b>
            <button type="button" className="btn sm ghost" onClick={() => setRejected([])}>Chiudi</button>
          </div>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {rejected.map((r, i) => <li key={i}><span className="mono">{r.name}</span>: {r.reason}</li>)}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 4 }}>
          <table className="table">
            <thead><tr><th>File</th><th style={{ width: 90 }}>Dimensione</th><th style={{ width: 150 }}>Stato</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {items.map((i) => {
                const [cls, label] = STATUS[i.status]
                const busy = i.status === 'uploading' || i.status === 'indexing'
                return (
                  <tr key={i.id}>
                    <td>
                      <span className="mono truncate" style={{ maxWidth: 420 }}>{i.file.name}</span>
                      {i.error && <div className="small" style={{ color: 'var(--primary)' }}>{i.error}</div>}
                    </td>
                    <td className="mono small">{fmtSize(i.file.size)}</td>
                    <td>
                      <span className={`badge ${cls}`}>{label}</span>
                      {busy && <div className="progress" style={{ marginTop: 6 }}><div style={{ width: i.status === 'uploading' ? '40%' : '80%' }} /></div>}
                    </td>
                    <td>
                      {!busy && i.status !== 'done' && (
                        <button type="button" className="btn sm ghost" aria-label={`Rimuovi ${i.file.name}`} title="Rimuovi" onClick={() => remove(i.id)}>✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <div className="row between wrap">
          <span className="small secondary" aria-live="polite">
            {running ? `Caricamento in corso: ${finished}/${active} completati…` : `${items.length} file nell’elenco`}
          </span>
          <div className="row wrap" style={{ gap: 6 }}>
            {!running && <button type="button" className="btn sm" onClick={() => { setItems([]); setSummary(null) }}>Svuota elenco</button>}
            {!running && failed > 0 && <button type="button" className="btn sm" onClick={() => start(items.filter((i) => i.status === 'error').map((i) => i.id))}>Riprova errori ({failed})</button>}
            {(running || ready > 0) && (
              <button type="button" className="btn primary" disabled={running} onClick={() => start()}>
                {running ? 'Caricamento…' : `Carica e indicizza ${ready} file`}
              </button>
            )}
          </div>
        </div>
      )}

      {summary && (
        <div className="card tight" role="status" style={{ borderColor: summary.failed.length ? 'var(--primary)' : 'var(--green, #1a7f37)' }}>
          <b className="small">
            {summary.ok} {summary.ok === 1 ? 'file caricato e indicizzato' : 'file caricati e indicizzati'}
            {summary.failed.length ? ` · ${summary.failed.length} con errore` : ' · nessun errore'}
          </b>
          {summary.failed.length > 0 && (
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {summary.failed.map((f, i) => <li key={i}><span className="mono">{f.name}</span>: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
