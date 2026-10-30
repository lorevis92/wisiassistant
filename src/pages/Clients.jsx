import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal, StatusBadge, Toast, useToast, Stat } from '../components/ui'
import { fmtDate, slugify } from '../lib/utils'
import { DEFAULT_MODEL, modelLabel } from '../lib/models'

export default function Clients() {
  const [clients, setClients] = useState(null)
  const [stats, setStats] = useState({})
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '', slug: '' })
  const [toast, setToast] = useToast()
  const nav = useNavigate()

  const load = async () => {
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    setClients(data || [])
    const { data: s } = await supabase.from('client_stats').select('*')
    const m = {}
    for (const r of s || []) m[r.client_id] = r
    setStats(m)
  }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    let domain = form.domain.trim()
    if (domain && !/^https?:\/\//i.test(domain)) domain = `https://${domain}`
    const slug = form.slug || slugify(form.name)
    const { data, error } = await supabase.from('clients').insert({
      name: form.name.trim(), domain, slug, model: DEFAULT_MODEL,
      allowed_domains: domain ? [new URL(domain).hostname] : [],
    }).select().single()
    if (error) return setToast(error.message)
    setOpen(false)
    nav(`/clients/${data.id}/crawling`)
  }

  const total = clients?.length || 0
  const ready = clients?.filter((c) => c.status === 'ready').length || 0
  const convs = Object.values(stats).reduce((a, s) => a + (s.conversations_30d || 0), 0)
  const openEsc = Object.values(stats).reduce((a, s) => a + (s.open_escalations || 0), 0)

  return (
    <div className="page">
      <Toast msg={toast} />
      <div className="row between" style={{ marginBottom: 20 }}>
        <div>
          <h1>Clienti</h1>
          <div className="secondary small" style={{ marginTop: 4 }}>Ogni cliente ha la propria knowledge base, modello AI e canali.</div>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Nuovo cliente</button>
      </div>

      <div className="grid4" style={{ marginBottom: 20 }}>
        <Stat k="Clienti" v={total} />
        <Stat k="Bot attivi" v={ready} />
        <Stat k="Conversazioni 30gg" v={convs} />
        <Stat k="Escalation aperte" v={openEsc} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th><th>Dominio</th><th>Stato</th><th>Pagine</th><th>Modello</th><th>Conv. 30gg</th><th>Canali</th><th>Creato</th>
            </tr>
          </thead>
          <tbody>
            {clients === null && <tr><td colSpan={8} className="empty">Caricamento…</td></tr>}
            {clients?.length === 0 && <tr><td colSpan={8} className="empty">Nessun cliente. Crea il primo.</td></tr>}
            {clients?.map((c) => {
              const s = stats[c.id] || {}
              return (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.id}`} style={{ color: 'var(--text)', fontWeight: 700 }}>{c.name}</Link></td>
                  <td className="mono"><span className="truncate" style={{ maxWidth: 220 }}>{c.domain?.replace(/^https?:\/\//, '')}</span></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="mono">{s.pages_indexed || 0}</td>
                  <td>{modelLabel(c.model)}</td>
                  <td className="mono">{s.conversations_30d || 0}</td>
                  <td>{(c.channels || ['web']).map((ch) => <span key={ch} className="badge" style={{ marginRight: 4 }}>{ch}</span>)}</td>
                  <td className="mono">{fmtDate(c.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={open} title="Nuovo cliente" onClose={() => setOpen(false)}>
        <form onSubmit={create}>
          <div className="field">
            <label className="label">Nome azienda</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} required />
          </div>
          <div className="field">
            <label className="label">Sito web</label>
            <input className="input" placeholder="https://www.esempio.ch" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
            <div className="hint">Il dominio viene usato per il crawling e per autorizzare il widget. Puoi aggiungerne altri dopo.</div>
          </div>
          <div className="field">
            <label className="label">Slug (URL pagina standalone)</label>
            <input className="input mono" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} required />
            <div className="hint">La chat sarà raggiungibile su /c/{form.slug || 'slug'}</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Annulla</button>
            <button className="btn primary">Crea e vai al crawling</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
