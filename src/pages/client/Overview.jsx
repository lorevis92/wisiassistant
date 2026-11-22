import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Stat, EmptyState, useToast, Toast } from '../../components/ui'
import BarChart from '../../components/BarChart'
import { modelLabel } from '../../lib/models'
import { daysAgo, fmtDateTime } from '../../lib/utils'
import { standaloneUrl, widgetSnippet } from '../../lib/brand'

const DAYS = 30

export default function Overview({ client }) {
  const [s, setS] = useState(null)
  const [top, setTop] = useState([])
  const [unanswered, setUnanswered] = useState([])
  const [convDays, setConvDays] = useState(null)
  const [toast, setToast] = useToast()

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('wa_client_stats').select('*').eq('client_id', client.id).maybeSingle()
      setS(data || {})
      const since = daysAgo(DAYS)
      const { data: cv } = await supabase.from('wa_conversations').select('created_at').eq('client_id', client.id).gte('created_at', since).limit(10000)
      setConvDays((cv || []).map((c) => c.created_at))
      const { data: q } = await supabase.from('wa_messages')
        .select('content, conversation:wa_conversations!inner(client_id)')
        .eq('role', 'user').eq('conversation.client_id', client.id).gte('created_at', since).limit(500)
      const freq = {}
      for (const m of q || []) {
        const k = (m.content || '').trim().toLowerCase().slice(0, 80)
        if (k.length > 6) freq[k] = (freq[k] || 0) + 1
      }
      setTop(Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8))
      const { data: un } = await supabase.from('wa_messages')
        .select('content, created_at, conversation:wa_conversations!inner(client_id)')
        .eq('role', 'user').eq('no_answer', true).eq('conversation.client_id', client.id).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(8)
      setUnanswered(un || [])
    })()
  }, [client.id])

  // conversations per local day, last 30 days (oldest first)
  const series = useMemo(() => {
    if (!convDays) return null
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const counts = {}
    for (const c of convDays) { const k = key(new Date(c)); counts[k] = (counts[k] || 0) + 1 }
    const out = []
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i)
      out.push({
        key: key(d), value: counts[key(d)] || 0,
        label: d.toLocaleDateString('it-CH', { weekday: 'short', day: 'numeric', month: 'long' }),
        short: d.toLocaleDateString('it-CH', { day: 'numeric', month: 'short' }),
      })
    }
    return out
  }, [convDays])

  const embed = widgetSnippet(client.slug)
  const maxTop = top[0]?.[1] || 1
  const copy = async () => { try { await navigator.clipboard.writeText(embed); setToast('Snippet copiato') } catch { setToast('Copia non riuscita: seleziona il testo e copialo') } }

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="grid4">
        <Stat k="Pagine indicizzate" v={s?.pages_indexed ?? '–'} s={`${s?.chunks ?? 0} sezioni di testo`} />
        <Stat k="Conversazioni (30 giorni)" v={s?.conversations_30d ?? '–'} s={`${s?.messages_30d ?? 0} messaggi`} />
        <Stat k="Risolte dall’assistente" v={s?.resolution_rate != null ? `${s.resolution_rate}%` : '–'} s="senza passaggio a operatore" />
        <Stat k="Lead raccolti" v={s?.leads ?? '–'} s={`${s?.open_escalations ?? 0} conversazioni in attesa`} />
      </div>

      <div className="card">
        <div className="row between wrap" style={{ marginBottom: 14, alignItems: 'baseline' }}>
          <div className="card-title" style={{ margin: 0 }}>Conversazioni al giorno</div>
          <span className="small muted">Ultimi {DAYS} giorni</span>
        </div>
        {series === null ? <div style={{ height: 200 }} /> : series.every((d) => !d.value) ? (
          <EmptyState icon="chart" title="Nessuna conversazione negli ultimi 30 giorni">
            Appena i visitatori iniziano a scrivere all’assistente, qui vedi l’andamento giorno per giorno.
          </EmptyState>
        ) : <BarChart data={series} />}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Domande più frequenti</div>
          {top.length === 0 ? <EmptyState icon="chat" title="Ancora nessuna domanda">Le domande ricorrenti dei visitatori compariranno qui.</EmptyState> : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {top.map(([q, n]) => (
                <li key={q}>
                  <div className="row between" style={{ gap: 12, alignItems: 'baseline' }}>
                    <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
                    <span className="small secondary num">{n}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 4, background: 'var(--surfaceAlt)', marginTop: 5 }}>
                    <div style={{ height: '100%', width: `${(n / maxTop) * 100}%`, borderRadius: 4, background: 'var(--chart)' }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card">
          <div className="card-title">Domande senza risposta</div>
          <p className="card-sub">Cosa manca sul sito o nei documenti del cliente. Compare anche nei report periodici.</p>
          {unanswered.length === 0 ? <EmptyState icon="chat" title="Nessuna domanda senza risposta">L’assistente ha trovato una risposta a tutto, negli ultimi 30 giorni.</EmptyState> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {unanswered.map((m, i) => (
                <li key={i} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <div className="small">{m.content}</div>
                  <div className="small muted num" style={{ marginTop: 2 }}>{fmtDateTime(m.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Incolla l’assistente nel sito</div>
          <p className="card-sub">Inserisci questo codice prima di <span className="mono">&lt;/body&gt;</span> in ogni pagina del sito.</p>
          <div className="code">{embed}</div>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button className="btn sm primary" onClick={copy}>Copia snippet</button>
            <a className="btn sm" href={standaloneUrl(client.slug)} target="_blank" rel="noopener">Apri la pagina chat</a>
          </div>
          <div className="hint">Funziona su qualsiasi sito, a meno che tu non limiti i domini in Impostazioni.</div>
        </div>
        <div className="card">
          <div className="card-title">Configurazione</div>
          <dl className="kv">
            <dt>Modello</dt><dd>{modelLabel(client.model)}</dd>
            <dt>Canali</dt><dd>{(client.channels || ['web']).join(', ')}</dd>
            <dt>Lingua</dt><dd>{client.language || 'auto'}</dd>
            {client.widget?.human_handoff === true && <><dt>Email operatore</dt><dd className="mono">{client.escalation_email || '–'}</dd></>}
            <dt>Soglia di confidenza</dt><dd className="num">{client.confidence_threshold ?? 0.35}</dd>
            <dt>Ultimo crawl</dt><dd className="num">{client.last_crawl_at ? fmtDateTime(client.last_crawl_at) : '–'}</dd>
          </dl>
          <Link className="btn sm" to={`/clients/${client.id}/settings`} style={{ marginTop: 14 }}>Modifica impostazioni</Link>
          <style>{`.kv{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:10px 18px;margin:0;font-size:var(--fs-sm)}.kv dt{color:var(--textSecondary)}.kv dd{margin:0;font-weight:500}`}</style>
        </div>
      </div>
    </div>
  )
}
