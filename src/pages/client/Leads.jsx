import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/utils'
import { EmptyState } from '../../components/ui'

export default function Leads({ client }) {
  const [leads, setLeads] = useState(null)
  useEffect(() => {
    supabase.from('wa_leads').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).then(({ data }) => setLeads(data || []))
  }, [client.id])

  const exportCsv = () => {
    const rows = [['Nome', 'Email', 'Telefono', 'Canale', 'Data', 'Conversazione'], ...(leads || []).map((l) => [l.name, l.email, l.phone, l.channel, l.created_at, l.conversation_id])]
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${client.slug}_leads.csv`; a.click()
  }

  return (
    <div className="card flush">
      <div className="pane-head">
        <span className="section-label">{leads?.length || 0} lead raccolti dall’assistente</span>
        <button className="btn sm" onClick={exportCsv} disabled={!leads?.length}>Esporta CSV</button>
      </div>
      {leads?.length === 0 ? <EmptyState icon="people" title="Nessun lead raccolto">Per chiedere nome ed email prima della chat, attiva la raccolta lead in Impostazioni.</EmptyState> : (
      <table className="table">
        <thead><tr><th>Nome</th><th>Email</th><th>Telefono</th><th>Canale</th><th>Data</th></tr></thead>
        <tbody>
          {leads?.map((l) => <tr key={l.id}><td>{l.name}</td><td className="mono">{l.email}</td><td className="mono">{l.phone}</td><td><span className="badge">{l.channel}</span></td><td className="mono small">{fmtDateTime(l.created_at)}</td></tr>)}
        </tbody>
      </table>
      )}
    </div>
  )
}
