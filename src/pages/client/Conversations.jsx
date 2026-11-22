import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusBadge, Toast, useToast, EmptyState, Spinner } from '../../components/ui'
import ChatThread from '../../components/ChatThread'
import { daysAgo, fmtDateTime, todayIso } from '../../lib/utils'
import { exportConversationsPdf } from '../../lib/pdf'
import { CHANNELS } from '../../lib/models'

export default function Conversations({ client }) {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(todayIso())
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [list, setList] = useState(null)
  const [active, setActive] = useState(null)
  const [messages, setMessages] = useState([])
  const [toast, setToast] = useToast()
  const [exporting, setExporting] = useState(false)

  const load = async () => {
    let q = supabase.from('wa_conversations').select('*').eq('client_id', client.id)
      .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`).order('created_at', { ascending: false }).limit(500)
    if (channel) q = q.eq('channel', channel)
    if (status) q = q.eq('status', status)
    const { data } = await q
    setList(data || [])
    if (data?.length && !active) setActive(data[0].id)
  }
  useEffect(() => { load() }, [client.id, from, to, channel, status])

  useEffect(() => {
    if (!active) return setMessages([])
    supabase.from('wa_messages').select('*').eq('conversation_id', active).order('created_at').then(({ data }) => setMessages(data || []))
  }, [active])

  const exportPdf = async () => {
    if (!list?.length) return setToast('Nessuna conversazione nel periodo')
    setExporting(true)
    const ids = list.map((c) => c.id)
    const { data: msgs } = await supabase.from('wa_messages').select('*').in('conversation_id', ids).order('created_at')
    const byConv = {}
    for (const m of msgs || []) (byConv[m.conversation_id] ||= []).push(m)
    const convs = [...list].reverse().map((c) => ({ ...c, messages: byConv[c.id] || [] }))
    await exportConversationsPdf({ clientName: client.name, from, to, conversations: convs })
    setExporting(false)
  }

  const current = list?.find((c) => c.id === active)

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="card tight row wrap" style={{ alignItems: 'flex-end' }}>
        <div><label className="label">Da</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">A</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label className="label">Canale</label>
          <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Tutti</option>{CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div><label className="label">Stato</label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tutti</option><option value="open">Aperta</option><option value="resolved">Risolta</option><option value="escalated">Escalation</option><option value="human">Umano</option>
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn primary" disabled={exporting} onClick={exportPdf}>{exporting ? 'Generazione…' : `Scarica PDF (${list?.length || 0})`}</button>
        </div>
      </div>

      <div className="split">
        <div className="pane" style={{ maxHeight: 680 }}>
          <div className="pane-head"><span className="section-label">{list ? `${list.length} conversazioni` : 'Conversazioni'}</span></div>
          <div className="pane-scroll">
            {list === null && <Spinner />}
            {list?.length === 0 && <EmptyState icon="chat" title="Nessuna conversazione nel periodo">Prova ad allargare le date o a togliere i filtri.</EmptyState>}
            {list?.map((c) => (
              <button type="button" key={c.id} className={`list-item${active === c.id ? ' active' : ''}`} onClick={() => setActive(c.id)} aria-current={active === c.id ? 'true' : undefined}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="who">{c.lead_name || c.visitor_label || `Visitatore ${c.id.slice(0, 6)}`}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="preview">{c.last_message || ''}</div>
                <div className="meta"><span>{c.channel}</span><span>{fmtDateTime(c.created_at)}, {c.message_count || 0} msg</span></div>
              </button>
            ))}
          </div>
        </div>
        <div className="pane" style={{ height: 680, maxHeight: '80vh' }}>
          {current ? (
            <>
              <div className="thread-head">
                <div style={{ minWidth: 0 }}>
                  <h3>{current.lead_name || current.visitor_label || `Visitatore ${current.id.slice(0, 6)}`}</h3>
                  <div className="small secondary" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{[current.lead_email, current.channel, current.page_url].filter(Boolean).join(', ')}</div>
                </div>
                {current.status !== 'resolved' && <button className="btn sm" onClick={async () => { await supabase.from('wa_conversations').update({ status: 'resolved' }).eq('id', current.id); load() }}>Segna risolta</button>}
              </div>
              <div className="thread-body"><ChatThread messages={messages} /></div>
            </>
          ) : <EmptyState icon="chat" title="Seleziona una conversazione">La trascrizione compare qui, come l’ha vista il visitatore.</EmptyState>}
        </div>
      </div>
    </div>
  )
}
