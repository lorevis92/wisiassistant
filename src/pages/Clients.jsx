import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal, StatusBadge, Toast, useToast, Stat, EmptyState } from '../components/ui'
import { fmtDate, slugify } from '../lib/utils'
import { DEFAULT_MODEL, modelLabel } from '../lib/models'
import { useAuth } from '../lib/auth'

export default function Clients() {
  const [clients, setClients] = useState(null)
  const [stats, setStats] = useState({})
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '', slug: '' })
  const [toast, setToast] = useToast()
  const nav = useNavigate()
  // the database returns only the clients this user can access (RLS); here we narrow to the organization in use
  const { org, isOrgAdmin, legacy } = useAuth()

  const load = async () => {
    let q = supabase.from('wa_clients').select('*').order('created_at', { ascending: false })
    if (!legacy && org?.id) q = q.eq('org_id', org.id)
    const { data } = await q
    setClients(data || [])
    const { data: s } = await supabase.from('wa_client_stats').select('*')
    const m = {}
    for (const r of s || []) m[r.client_id] = r
    setStats(m)
  }
  useEffect(() => { load() }, [org?.id])

  const create = async (e) => {
    e.preventDefault()
    let domain = form.domain.trim()
    if (domain && !/^https?:\/\//i.test(domain)) domain = `https://${domain}`
    const slug = form.slug || slugify(form.name)
    const { data, error } = await supabase.from('wa_clients').insert({
      name: form.name.trim(), domain, slug, model: DEFAULT_MODEL, ...(!legacy && org?.id ? { org_id: org.id } : {}),
    }).select().single()
    if (error) return setToast(error.message)
    setOpen(false)
    nav(`/clients/${data.id}/crawling`)
  }

  const total = clients?.length || 0
  const ready = clients?.filter((c) => c.status === 'ready').length || 0
  const convs = (clients || []).reduce((a, c) => a + (stats[c.id]?.conversations_30d || 0), 0)
  const openEsc = (clients || []).reduce((a, c) => a + (stats[c.id]?.open_escalations || 0), 0)

  return (
    <div className="page">
      <Toast msg={toast} />
      <div className="page-head">
        <div>
          <h1>Clienti</h1>
          <p className="lead" style={{ margin: '6px 0 0' }}>{isOrgAdmin ? 'Ogni cliente ha la propria knowledge base, il proprio modello AI e i propri canali.' : 'I clienti che ti sono stati assegnati.'}</p>
        </div>
        {isOrgAdmin && <button className="btn primary" onClick={() => setOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Nuovo cliente
        </button>}
      </div>

      <div className="grid4" style={{ marginBottom: 24 }}>
        <Stat k="Clienti" v={total} />
        <Stat k="Bot attivi" v={ready} />
        <Stat k="Conversazioni 30gg" v={convs} />
        <Stat k="Escalation aperte" v={openEsc} />
      </div>

      <div className="card flush">
        {clients?.length === 0 ? (
          isOrgAdmin ? (
            <EmptyState icon="people" title="Ancora nessun cliente" action={<button className="btn primary" onClick={() => setOpen(true)}>Crea il primo cliente</button>}>
              Crea un cliente, mappa il suo sito e in pochi minuti l’assistente è pronto da incollare nel sito.
            </EmptyState>
          ) : (
            <EmptyState icon="people" title="Nessun cliente assegnato">Quando un amministratore ti assegna un cliente, lo trovi qui.</EmptyState>
          )
        ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th><th>Dominio</th><th>Stato</th><th>Pagine</th><th>Modello</th><th>Conv. 30gg</th><th>Canali</th><th>Creato</th>
            </tr>
          </thead>
          <tbody>
            {clients === null && <tr><td colSpan={8} className="empty">Caricamento…</td></tr>}
            {clients?.map((c) => {
              const s = stats[c.id] || {}
              return (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.id}`} style={{ color: 'var(--text)', fontWeight: 600 }}>{c.name}</Link></td>
                  <td className="mono"><span className="truncate" style={{ maxWidth: 220 }}>{c.domain?.replace(/^https?:\/\//, '')}</span></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="mono">{s.pages_indexed || 0}</td>
                  <td>{modelLabel(c.model)}</td>
                  <td className="mono">{s.conversations_30d || 0}</td>
                  <td><span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{(c.channels || ['web']).map((ch) => <span key={ch} className="badge">{ch}</span>)}</span></td>
                  <td className="mono">{fmtDate(c.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        )}
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
            <div className="hint">Il sito da cui l’assistente impara. Puoi aggiungere altri domini dopo.</div>
          </div>
          <div className="field">
            <label className="label">Slug (URL pagina standalone)</label>
            <input className="input mono" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} required />
            <div className="hint">La chat sarà raggiungibile su /c/{form.slug || 'slug'}</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Annulla</button>
            <button className="btn primary">Crea e mappa il sito</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
