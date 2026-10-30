import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/utils'

export default function Leads({ client }) {
  const [leads, setLeads] = useState(null)
  useEffect(() => {
    supabase.from('leads').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).then(({ data }) => setLeads(data || []))
  }, [client.id])

  const exportCsv = () => {
    const rows = [['Nome', 'Email', 'Telefono', 'Canale', 'Data', 'Conversazione'], ...(leads || []).map((l) => [l.name, l.email, l.phone, l.channel, l.created_at, l.conversation_id])]
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${client.slug}_leads.csv`; a.click()
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="row between" style={{ padding: 12 }}>
        <span className="section-label">{leads?.length || 0} lead raccolti dal bot</span>
        <button className="btn sm" onClick={exportCsv} disabled={!leads?.length}>Esporta CSV</button>
      </div>
      <table className="table">
        <thead><tr><th>Nome</th><th>Email</th><th>Telefono</th><th>Canale</th><th>Data</th></tr></thead>
        <tbody>
          {leads?.length === 0 && <tr><td colSpan={5} className="empty">Nessun lead. Attiva la raccolta in Impostazioni → Widget.</td></tr>}
          {leads?.map((l) => <tr key={l.id}><td>{l.name}</td><td className="mono">{l.email}</td><td className="mono">{l.phone}</td><td><span className="badge">{l.channel}</span></td><td className="mono small">{fmtDateTime(l.created_at)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}
