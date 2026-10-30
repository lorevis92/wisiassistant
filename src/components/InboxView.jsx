import { useEffect, useRef, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'
import { StatusBadge, Toast, useToast } from './ui'
import ChatThread from './ChatThread'
import { fmtDateTime } from '../lib/utils'

/**
 * Live human handoff inbox. Shows conversations with status 'escalated' or 'human' (operator took over).
 * The operator's replies are sent through the `chat` function with mode 'human_reply' so they reach
 * every channel (widget polls / Telegram / WhatsApp are delivered by the function).
 */
export default function InboxView({ clientId = null }) {
  const [list, setList] = useState(null)
  const [active, setActive] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [toast, setToast] = useToast()
  const [clients, setClients] = useState({})
  const [showResolved, setShowResolved] = useState(false)
  const bottom = useRef(null)

  const load = async () => {
    let q = supabase.from('wa_conversations').select('*').order('updated_at', { ascending: false }).limit(200)
    q = showResolved ? q.in('status', ['escalated', 'human', 'resolved']) : q.in('status', ['escalated', 'human'])
    if (clientId) q = q.eq('client_id', clientId)
    const { data } = await q
    setList(data || [])
    if (!clientId) {
      const { data: cs } = await supabase.from('wa_clients').select('id,name')
      const m = {}; for (const c of cs || []) m[c.id] = c.name; setClients(m)
    }
  }
  useEffect(() => { load() }, [clientId, showResolved])

  useEffect(() => {
    const ch = supabase.channel(`inbox-${clientId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages' }, (p) => {
        if (p.new.conversation_id === active) setMessages((m) => [...m, p.new])
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clientId, active, showResolved])

  useEffect(() => {
    if (!active) return
    supabase.from('wa_messages').select('*').eq('conversation_id', active).order('created_at').then(({ data }) => setMessages(data || []))
  }, [active])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const current = list?.find((c) => c.id === active)

  const takeOver = async () => { await supabase.from('wa_conversations').update({ status: 'human' }).eq('id', active); load() }
  const giveBack = async () => { await supabase.from('wa_conversations').update({ status: 'open' }).eq('id', active); setActive(null); load() }
  const resolve = async () => { await supabase.from('wa_conversations').update({ status: 'resolved' }).eq('id', active); load() }

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    try {
      if (current.status !== 'human') await takeOver()
      await callFunction('chat', { mode: 'human_reply', conversation_id: active, content: text.trim() })
      setText('')
    } catch (er) { setToast(er.message) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16 }}>
      <Toast msg={toast} />
      <div className="card" style={{ padding: 0, maxHeight: 680, overflow: 'auto' }}>
        <div className="row between" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <span className="section-label">Da gestire</span>
          <label className="small secondary row" style={{ gap: 4 }}><input type="checkbox" className="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />risolte</label>
        </div>
        {list === null && <div className="empty">Caricamento…</div>}
        {list?.length === 0 && <div className="empty">Nessuna conversazione in attesa 🎉</div>}
        {list?.map((c) => (
          <div key={c.id} onClick={() => setActive(c.id)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: active === c.id ? 'var(--primaryLight)' : '#fff' }}>
            <div className="row between">
              <span className="small" style={{ fontWeight: 700 }}>{!clientId && clients[c.client_id] ? `${clients[c.client_id]} · ` : ''}{c.lead_name || c.visitor_label || `Visitatore ${c.id.slice(0, 6)}`}</span>
              <StatusBadge status={c.status} />
            </div>
            <div className="small secondary truncate" style={{ maxWidth: 300, marginTop: 3 }}>{c.last_message || ''}</div>
            <div className="row between" style={{ marginTop: 4 }}><span className="badge">{c.channel}</span><span className="mono small muted">{fmtDateTime(c.updated_at)}</span></div>
          </div>
        ))}
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 680 }}>
        {current ? (
          <>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{current.lead_name || current.visitor_label || `Visitatore ${current.id.slice(0, 6)}`}</div>
                <div className="small secondary mono">{[current.lead_email, current.channel, current.escalation_reason].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="row">
                {current.status === 'escalated' && <button className="btn sm primary" onClick={takeOver}>Prendi in carico</button>}
                {current.status === 'human' && <button className="btn sm" onClick={giveBack}>Restituisci al bot</button>}
                {current.status !== 'resolved' && <button className="btn sm" onClick={resolve}>Risolta</button>}
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
              <ChatThread messages={messages} />
              <div ref={bottom} />
            </div>
            <form onSubmit={send} className="row" style={{ marginTop: 12 }}>
              <input className="input" placeholder="Scrivi come operatore…" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary">Invia</button>
            </form>
          </>
        ) : <div className="empty">Seleziona una conversazione</div>}
      </div>
    </div>
  )
}
