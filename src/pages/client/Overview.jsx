import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Stat } from '../../components/ui'
import { modelLabel } from '../../lib/models'
import { daysAgo } from '../../lib/utils'

export default function Overview({ client }) {
  const [s, setS] = useState(null)
  const [top, setTop] = useState([])
  const [unanswered, setUnanswered] = useState([])

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('wa_client_stats').select('*').eq('client_id', client.id).maybeSingle()
      setS(data || {})
      const since = daysAgo(30)
      const { data: q } = await supabase.from('wa_messages')
        .select('content, conversation:conversations!inner(client_id)')
        .eq('role', 'user').eq('conversation.client_id', client.id).gte('created_at', since).limit(500)
      const freq = {}
      for (const m of q || []) {
        const k = (m.content || '').trim().toLowerCase().slice(0, 80)
        if (k.length > 6) freq[k] = (freq[k] || 0) + 1
      }
      setTop(Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8))
      const { data: un } = await supabase.from('wa_messages')
        .select('content, created_at, conversation:conversations!inner(client_id)')
        .eq('role', 'user').eq('no_answer', true).eq('conversation.client_id', client.id).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(8)
      setUnanswered(un || [])
    })()
  }, [client.id])

  const embed = `<script src="${window.location.origin}/widget.js" data-client="${client.slug}" async></script>`

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid4">
        <Stat k="Pagine indicizzate" v={s?.pages_indexed ?? '…'} s={`${s?.chunks ?? 0} chunk`} />
        <Stat k="Conversazioni 30gg" v={s?.conversations_30d ?? '…'} s={`${s?.messages_30d ?? 0} messaggi`} />
        <Stat k="Risolte dal bot" v={s?.resolution_rate != null ? `${s.resolution_rate}%` : '…'} s="senza escalation" />
        <Stat k="Escalation aperte" v={s?.open_escalations ?? '…'} s={`${s?.leads ?? 0} lead raccolti`} />
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Configurazione</div>
          <table className="table">
            <tbody>
              <tr><td className="secondary">Modello</td><td>{modelLabel(client.model)}</td></tr>
              <tr><td className="secondary">Canali</td><td>{(client.channels || ['web']).join(', ')}</td></tr>
              <tr><td className="secondary">Lingua</td><td>{client.language || 'auto'}</td></tr>
              <tr><td className="secondary">Soglia confidenza</td><td className="mono">{client.confidence_threshold ?? 0.35}</td></tr>
              <tr><td className="secondary">Escalation email</td><td className="mono">{client.escalation_email || '—'}</td></tr>
              <tr><td className="secondary">Ultimo crawl</td><td className="mono">{client.last_crawl_at ? new Date(client.last_crawl_at).toLocaleString('it-CH') : '—'}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-title">Snippet da incollare nel sito del cliente</div>
          <div className="code">{embed}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(embed)}>Copia</button>
            <a className="btn sm" href={`/c/${client.slug}`} target="_blank" rel="noopener">Pagina standalone ↗</a>
          </div>
          <div className="hint">Il widget risponde solo dai domini autorizzati (Impostazioni → Domini). Inserire prima di <span className="mono">&lt;/body&gt;</span>.</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Domande più frequenti (30gg)</div>
          {top.length === 0 ? <div className="empty">Ancora nessun dato</div> : (
            <table className="table">
              <tbody>{top.map(([q, n]) => <tr key={q}><td>{q}</td><td className="mono" style={{ width: 40, textAlign: 'right' }}>{n}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-title">Domande senza risposta (30gg)</div>
          {unanswered.length === 0 ? <div className="empty">Nessuna — ottimo</div> : (
            <table className="table">
              <tbody>{unanswered.map((m, i) => <tr key={i}><td className="truncate">{m.content}</td></tr>)}</tbody>
            </table>
          )}
          <div className="hint">Utile per capire cosa manca sul sito del cliente. Compare anche nei report periodici.</div>
        </div>
      </div>
    </div>
  )
}
