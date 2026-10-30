import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { StatusBadge } from '../../components/ui'
import Overview from './Overview'
import Crawling from './Crawling'
import Knowledge from './Knowledge'
import Conversations from './Conversations'
import ClientInbox from './ClientInbox'
import ClientReports from './ClientReports'
import Settings from './Settings'
import Leads from './Leads'

const TABS = [
  ['', 'Panoramica'],
  ['crawling', 'Crawling'],
  ['knowledge', 'Knowledge'],
  ['conversations', 'Conversazioni'],
  ['inbox', 'Inbox'],
  ['leads', 'Lead'],
  ['reports', 'Report'],
  ['settings', 'Impostazioni'],
]

export default function ClientPage() {
  const { id } = useParams()
  const [client, setClient] = useState(null)

  const reload = async () => {
    const { data } = await supabase.from('wa_clients').select('*').eq('id', id).single()
    setClient(data)
  }
  useEffect(() => { reload() }, [id])

  useEffect(() => {
    const ch = supabase.channel(`client-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wa_clients', filter: `id=eq.${id}` }, (p) => setClient(p.new))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id])

  if (!client) return <div className="empty">Caricamento…</div>

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 16 }}>
        <div>
          <div className="small secondary"><Link to="/" style={{ color: 'var(--textSecondary)' }}>Clienti</Link> / {client.name}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <h1>{client.name}</h1>
            <StatusBadge status={client.status} />
          </div>
          <div className="mono small secondary" style={{ marginTop: 4 }}>{client.domain}</div>
        </div>
        <div className="row">
          <a className="btn" href={`/c/${client.slug}`} target="_blank" rel="noopener">Apri chat ↗</a>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={`/clients/${id}/${path}`} end={path === ''} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>{label}</NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<Overview client={client} />} />
        <Route path="crawling" element={<Crawling client={client} reload={reload} />} />
        <Route path="knowledge" element={<Knowledge client={client} />} />
        <Route path="conversations" element={<Conversations client={client} />} />
        <Route path="inbox" element={<ClientInbox client={client} />} />
        <Route path="leads" element={<Leads client={client} />} />
        <Route path="reports" element={<ClientReports client={client} reload={reload} />} />
        <Route path="settings" element={<Settings client={client} reload={reload} />} />
      </Routes>
    </div>
  )
}
