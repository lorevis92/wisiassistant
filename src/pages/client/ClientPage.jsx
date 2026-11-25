import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import { standaloneUrl, BRAND } from '../../lib/brand'
import { supabase } from '../../lib/supabase'
import { StatusBadge, Spinner, EmptyState } from '../../components/ui'
import Overview from './Overview'
import Crawling from './Crawling'
import Knowledge from './Knowledge'
import Conversations from './Conversations'
import ClientInbox from './ClientInbox'
import ClientReports from './ClientReports'
import Settings from './Settings'
import Leads from './Leads'
import TestQuestions from './TestQuestions'

const TABS = [
  ['', 'Panoramica'],
  ['crawling', 'Crawling'],
  ['knowledge', 'Knowledge'],
  ['conversations', 'Conversazioni'],
  ['inbox', 'Inbox'],
  ['leads', 'Lead'],
  ['reports', 'Report'],
  ['tests', 'Prova'],
  ['settings', 'Impostazioni'],
]

export default function ClientPage() {
  const { id } = useParams()
  const [client, setClient] = useState(null)

  const [missing, setMissing] = useState(false)
  const reload = async () => {
    // RLS returns nothing for a client the user cannot access (not in the org, or not assigned to a collaborator)
    const { data } = await supabase.from('wa_clients').select('*').eq('id', id).maybeSingle()
    setMissing(!data)
    if (data) setClient(data)
  }

  useEffect(() => { reload() }, [id])
  useEffect(() => { if (client?.name) document.title = `${client.name} · ${BRAND}`; return () => { document.title = BRAND } }, [client?.name])

  useEffect(() => {
    const ch = supabase.channel(`client-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_clients', filter: `id=eq.${id}` }, (p) => setClient(p.new))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id])

  if (missing) {
    return (
      <div className="page">
        <EmptyState icon="people" title="Cliente non disponibile" action={<Link className="btn" to="/">Torna ai clienti</Link>}>
          Questo cliente non esiste oppure non ti è stato assegnato.
        </EmptyState>
      </div>
    )
  }
  if (!client) return <Spinner />

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <nav className="crumbs" aria-label="Percorso"><Link to="/">Clienti</Link> <span aria-hidden="true">/</span> {client.name}</nav>
          <div className="row wrap" style={{ gap: 12 }}>
            <h1>{client.name}</h1>
            <StatusBadge status={client.status} />
          </div>
          {client.domain && <a className="mono small" href={client.domain} target="_blank" rel="noopener" style={{ color: 'var(--textSecondary)', display: 'inline-block', marginTop: 6 }}>{client.domain.replace(/^https?:\/\//, '')}</a>}
        </div>
        <a className="btn" href={standaloneUrl(client.slug)} target="_blank" rel="noopener">
          Apri la chat
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </a>
      </div>

      {client.last_recrawl_status === 'error' && (
        <div className="callout danger row between wrap" style={{ marginBottom: 16 }}>
          <span className="small">
            <StatusBadge status="failed" /> <b>Re-crawl automatico fallito</b>{client.last_recrawl_at ? ` il ${new Date(client.last_recrawl_at).toLocaleString('it-CH')}` : ''}: {client.last_recrawl_error || 'errore sconosciuto'}
            <span className="secondary"> · Il bot continua a usare i contenuti indicizzati in precedenza.</span>
          </span>
          <NavLink className="btn sm" to={`/clients/${id}/crawling`}>Vedi storico</NavLink>
        </div>
      )}

      <nav className="subnav" aria-label="Sezioni del cliente">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={`/clients/${id}/${path}`} end={path === ''} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Overview client={client} />} />
        <Route path="crawling" element={<Crawling client={client} reload={reload} />} />
        <Route path="knowledge" element={<Knowledge client={client} />} />
        <Route path="conversations" element={<Conversations client={client} />} />
        <Route path="inbox" element={<ClientInbox client={client} />} />
        <Route path="leads" element={<Leads client={client} />} />
        <Route path="reports" element={<ClientReports client={client} reload={reload} />} />
        <Route path="settings" element={<Settings client={client} reload={reload} />} />
        <Route path="tests" element={<TestQuestions client={client} />} />
      </Routes>
    </div>
  )
}
