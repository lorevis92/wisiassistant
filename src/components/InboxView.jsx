import { useEffect, useRef, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'
import { StatusBadge, Toast, useToast, EmptyState, Spinner } from './ui'
import { useAuth } from '../lib/auth'
import ChatThread from './ChatThread'
import { fmtDateTime } from '../lib/utils'

/**
 * Live human handoff inbox of ONE client (there is no cross-client inbox: access is per client). Shows conversations with status 'escalated' or 'human' (operator took over).
 * The operator's replies are sent through the `chat` function with mode 'human_reply' so they reach
 * every channel (widget polls / Telegram / WhatsApp are delivered by the function).
 */
export default function InboxView({ clientId }) {
  const { isOrgAdmin } = useAuth()
  const [list, setList] = useState(null)
  const [active, setActive] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [toast, setToast] = useToast()
  const [showResolved, setShowResolved] = useState(false)
  const bottom = useRef(null)

  const load = async () => {
    let q = supabase.from('wa_conversations').select('*').order('updated_at', { ascending: false }).limit(200)
    q = showResolved ? q.in('status', ['escalated', 'human', 'resolved']) : q.in('status', ['escalated', 'human'])
    q = q.eq('client_id', clientId)
    const { data } = await q
    setList(data || [])
  }
  useEffect(() => { load() }, [clientId, showResolved])

  useEffect(() => {
    const ch = supabase.channel(`inbox-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations', filter: `client_id=eq.${clientId}` }, () => load())
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
    <div className="split">
      <Toast msg={toast} />
      <div className="pane" style={{ maxHeight: 700 }}>
        <div className="pane-head">
          <span className="section-label">Da gestire{list?.length ? ` (${list.length})` : ''}</span>
          <label className="small secondary row" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" className="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />Mostra risolte</label>
        </div>
        <div className="pane-scroll">
          {list === null && <Spinner />}
          {list?.length === 0 && <EmptyState icon="inbox" title="Nessuna conversazione in attesa">Quando una conversazione passa a un operatore la trovi qui.</EmptyState>}
          {list?.map((c) => (
            <button type="button" key={c.id} className={`list-item${active === c.id ? ' active' : ''}`} onClick={() => setActive(c.id)} aria-current={active === c.id ? 'true' : undefined}>
              <div className="row between" style={{ gap: 8 }}>
                <span className="who">{c.lead_name || c.visitor_label || `Visitatore ${c.id.slice(0, 6)}`}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="preview">{c.last_message || ''}</div>
              <div className="meta"><span>{c.channel}</span><span>{fmtDateTime(c.updated_at)}</span></div>
            </button>
          ))}
        </div>
      </div>
      <div className="pane" style={{ height: 700, maxHeight: '80vh' }}>
        {current ? (
          <>
            <div className="thread-head">
              <div style={{ minWidth: 0 }}>
                <h3>{current.lead_name || current.visitor_label || `Visitatore ${current.id.slice(0, 6)}`}</h3>
                <div className="small secondary" style={{ marginTop: 4 }}>{[current.lead_email, current.channel, current.escalation_reason].filter(Boolean).join(', ')}</div>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {current.status === 'escalated' && <button className="btn sm primary" onClick={takeOver}>Prendi in carico</button>}
                {current.status === 'human' && <button className="btn sm" onClick={giveBack}>Restituisci al bot</button>}
                {current.status !== 'resolved' && <button className="btn sm" onClick={resolve}>Segna risolta</button>}
              </div>
            </div>
            <div className="thread-body">
              <ChatThread messages={messages} showWhy={isOrgAdmin} />
              <div ref={bottom} />
            </div>
            <form onSubmit={send} className="thread-compose">
              <input className="input" aria-label="Risposta dell’operatore" placeholder="Scrivi come operatore…" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary" disabled={!text.trim()}>Invia</button>
            </form>
          </>
        ) : <EmptyState icon="chat" title="Seleziona una conversazione">Scegli una conversazione dall’elenco per leggerla e rispondere.</EmptyState>}
      </div>
    </div>
  )
}
