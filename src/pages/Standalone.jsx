import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { renderMessageHtml } from '../lib/utils'

/** Public standalone chat page: /c/:slug — no login, talks to the `chat` edge function like the widget. */
export default function Standalone() {
  const { slug } = useParams()
  const [cfg, setCfg] = useState(null)
  const [err, setErr] = useState('')
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [convId, setConvId] = useState(null) // set once the saved conversation's history is loaded
  const [lead, setLead] = useState({ name: '', email: '' })
  const [leadDone, setLeadDone] = useState(false)
  const bottom = useRef(null)
  const lastIdRef = useRef(null) // poll cursor: id of the last server-side message shown
  const storeKey = `wa-conv-${slug}`

  const api = async (body) => {
    const r = await fetch(`${FUNCTIONS_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j.error || 'Errore'), { status: r.status })
    return j
  }
  const welcome = (c) => ({ role: 'assistant', content: c.widget?.welcome || 'Ciao! Come posso aiutarti?' })
  const resetConv = () => { sessionStorage.removeItem(storeKey); setConvId(null); lastIdRef.current = null }

  useEffect(() => {
    let alive = true
    ;(async () => {
      let c
      try { c = await api({ mode: 'config', client_slug: slug, channel: 'standalone' }) } catch (e) { if (alive) setErr(e.message); return }
      if (!alive) return
      setCfg(c); document.title = `${c.widget?.title || 'Assistente'} · ${c.name}`
      const saved = sessionStorage.getItem(storeKey)
      if (saved) {
        // page reloaded: show the full transcript and poll from its last message
        try {
          const h = await api({ mode: 'history', client_slug: slug, conversation_id: saved })
          if (!alive) return
          const hist = h.messages || []
          lastIdRef.current = hist.length ? hist[hist.length - 1].id : null
          setLeadDone(true); setConvId(saved); setMsgs([welcome(c), ...hist])
          return
        } catch { if (!alive) return; resetConv() } // gone or failed: start over
      }
      setMsgs([welcome(c)])
    })()
    return () => { alive = false }
  }, [slug])

  useEffect(() => {
    // Picks up operator (human) replies after the cursor (the server never returns bot replies here).
    if (!convId) return
    let alive = true
    const t = setInterval(async () => {
      try {
        const r = await api({ mode: 'poll', client_slug: slug, conversation_id: convId, after_id: lastIdRef.current })
        if (!alive) return
        const got = r.messages || []
        if (got.length) lastIdRef.current = got[got.length - 1].id
        else if (!lastIdRef.current && r.cursor) lastIdRef.current = r.cursor
        if (got.length) setMsgs((m) => [...m, ...got.filter((g) => !m.some((x) => x.id === g.id))])
      } catch (e) { if (alive && e.status === 404) resetConv() }
    }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [convId])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (q) => {
    const content = (q ?? text).trim(); if (!content || busy) return
    setText(''); setBusy(true)
    setMsgs((m) => [...m, { role: 'user', content }])
    try {
      const r = await api({ mode: 'message', client_slug: slug, conversation_id: convId, content, channel: 'standalone', page_url: location.href, lead: leadDone ? lead : undefined })
      if (r.conversation_id && r.conversation_id !== convId) { lastIdRef.current = r.message_id || null; setConvId(r.conversation_id); sessionStorage.setItem(storeKey, r.conversation_id) }
      setMsgs((m) => [...m, { role: r.role || 'assistant', content: r.content, id: r.message_id, no_answer: r.no_answer }])
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: `Si è verificato un errore: ${e.message}` }]) }
    setBusy(false)
  }
  const newConversation = () => { if (busy) return; resetConv(); setLeadDone(false); setLead({ name: '', email: '' }); setText(''); setMsgs([welcome(cfg)]) }
  const feedback = async (id, v) => { try { await api({ mode: 'feedback', message_id: id, value: v }) } catch { /* ignore */ } setMsgs((m) => m.map((x) => (x.id === id ? { ...x, feedback: v } : x))) }

  if (err) return <div className="empty">Assistente non disponibile ({err})</div>
  if (!cfg) return <div className="empty">Caricamento…</div>
  const color = cfg.widget?.color || '#E8352A'
  const needLead = cfg.widget?.lead_capture === 'before' && !leadDone

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <div style={{ background: color, color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        {cfg.widget?.avatar_url && <img src={cfg.widget.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />}
        <div><div style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{cfg.widget?.title || 'Assistente'}</div><div style={{ fontSize: 11, opacity: 0.85 }}>{cfg.name}</div></div>
        <button type="button" onClick={newConversation} disabled={busy} style={{ marginLeft: 'auto', background: 'none', color: '#fff', border: '1px solid rgba(255,255,255,.6)', borderRadius: 3, padding: '5px 9px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' }}>Nuova conversazione</button>
      </div>
      <div style={{ flex: 1, maxWidth: 760, width: '100%', margin: '0 auto', padding: 20 }}>
        {needLead ? (
          <form className="card" onSubmit={(e) => { e.preventDefault(); setLeadDone(true) }}>
            <div className="card-title">Prima di iniziare</div>
            <div className="field"><label className="label">Nome</label><input className="input" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} required /></div>
            <div className="field"><label className="label">Email</label><input className="input" type="email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} required /></div>
            <button className="btn primary" style={{ background: color, borderColor: color }}>Inizia la chat</button>
          </form>
        ) : (
          <div className="chat">
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`} style={m.role === 'user' ? { background: color } : {}}>
                <div dangerouslySetInnerHTML={{ __html: renderMessageHtml(m.content) }} />
                {m.role === 'assistant' && m.id && (
                  <div className="meta" style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => feedback(m.id, 1)} style={{ background: 'none', border: 'none', opacity: m.feedback === 1 ? 1 : 0.5 }}>👍</button>
                    <button onClick={() => feedback(m.id, -1)} style={{ background: 'none', border: 'none', opacity: m.feedback === -1 ? 1 : 0.5 }}>👎</button>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="msg assistant muted">…</div>}
            {msgs.length === 1 && cfg.widget?.suggestions?.length > 0 && (
              <div className="row wrap">{cfg.widget.suggestions.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}</div>
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>
      {!needLead && (
        <form onSubmit={(e) => { e.preventDefault(); send() }} style={{ borderTop: '1px solid var(--border)', background: '#fff', padding: 12 }}>
          <div className="row" style={{ maxWidth: 760, margin: '0 auto' }}>
            <input className="input" placeholder="Scrivi un messaggio…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <button className="btn primary" style={{ background: color, borderColor: color }} disabled={busy}>Invia</button>
          </div>
          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--textMuted)', marginTop: 8 }}>Powered by WISI Assistant</div>
        </form>
      )}
    </div>
  )
}
