import { useEffect, useState } from 'react'
import { supabase, callFunction } from '../../lib/supabase'
import { StatusBadge, Toast, useToast, Modal } from '../../components/ui'
import { fmtDateTime } from '../../lib/utils'

/** Manual knowledge: PDF / text / FAQ entries. Each becomes a "page" of kind 'document' or 'faq' and gets chunked+embedded by the `ingest` function. */
export default function Knowledge({ client }) {
  const [docs, setDocs] = useState(null)
  const [toast, setToast] = useToast()
  const [faqOpen, setFaqOpen] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const [faq, setFaq] = useState({ question: '', answer: '', link: '' })
  const [txt, setTxt] = useState({ title: '', content: '', link: '' })
  const [uploading, setUploading] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('pages').select('id,url,title,kind,status,chunk_count,enabled,last_crawled_at,error,created_at')
      .eq('client_id', client.id).in('kind', ['document', 'faq', 'text']).order('created_at', { ascending: false })
    setDocs(data || [])
  }
  useEffect(() => { load() }, [client.id])
  useEffect(() => {
    const ch = supabase.channel(`kb-${client.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pages', filter: `client_id=eq.${client.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [client.id])

  const uploadPdf = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const path = `${client.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: false })
      if (error) throw error
      await callFunction('ingest', { client_id: client.id, kind: 'document', storage_path: path, title: file.name })
      setToast('Documento caricato, indicizzazione in corso')
    } catch (e) { setToast(e.message) }
    setUploading(false)
  }

  const addFaq = async (e) => {
    e.preventDefault()
    try {
      await callFunction('ingest', { client_id: client.id, kind: 'faq', title: faq.question, content: `Domanda: ${faq.question}\n\nRisposta: ${faq.answer}`, link: faq.link || null })
      setFaq({ question: '', answer: '', link: '' }); setFaqOpen(false); setToast('FAQ aggiunta')
    } catch (er) { setToast(er.message) }
  }
  const addText = async (e) => {
    e.preventDefault()
    try {
      await callFunction('ingest', { client_id: client.id, kind: 'text', title: txt.title, content: txt.content, link: txt.link || null })
      setTxt({ title: '', content: '', link: '' }); setTextOpen(false); setToast('Testo aggiunto')
    } catch (er) { setToast(er.message) }
  }
  const del = async (id) => { if (confirm('Eliminare?')) { await supabase.from('pages').delete().eq('id', id); load() } }
  const toggle = async (d) => { await supabase.from('pages').update({ enabled: !d.enabled }).eq('id', d.id); load() }

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="grid3">
        <div className="card">
          <div className="card-title">Carica PDF / DOCX / TXT</div>
          <input type="file" accept=".pdf,.txt,.md,.docx" onChange={(e) => uploadPdf(e.target.files?.[0])} disabled={uploading} />
          <div className="hint">Listini, condizioni, manuali. Il contenuto viene spezzato in sezioni e indicizzato insieme al sito.</div>
        </div>
        <div className="card">
          <div className="card-title">FAQ scritta a mano</div>
          <button className="btn" onClick={() => setFaqOpen(true)}>+ Aggiungi FAQ</button>
          <div className="hint">Ideale per risposte che sul sito non ci sono (orari, politiche, promozioni). Puoi allegare un link da proporre all’utente.</div>
        </div>
        <div className="card">
          <div className="card-title">Testo libero</div>
          <button className="btn" onClick={() => setTextOpen(true)}>+ Aggiungi testo</button>
          <div className="hint">Un blocco di istruzioni/informazioni generiche sul cliente.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr><th>Titolo</th><th>Tipo</th><th>Stato</th><th>Chunk</th><th>Aggiunto</th><th></th></tr></thead>
          <tbody>
            {docs === null && <tr><td colSpan={6} className="empty">Caricamento…</td></tr>}
            {docs?.length === 0 && <tr><td colSpan={6} className="empty">Nessun contenuto manuale</td></tr>}
            {docs?.map((d) => (
              <tr key={d.id} style={{ opacity: d.enabled ? 1 : 0.5 }}>
                <td><span className="truncate" style={{ maxWidth: 420 }}>{d.title}</span>{d.error && <div className="small" style={{ color: 'var(--primary)' }}>{d.error}</div>}</td>
                <td><span className="badge">{d.kind}</span></td>
                <td><StatusBadge status={d.status} /></td>
                <td className="mono">{d.chunk_count || 0}</td>
                <td className="mono small">{fmtDateTime(d.created_at)}</td>
                <td className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn sm ghost" onClick={() => toggle(d)}>{d.enabled ? 'Disattiva' : 'Attiva'}</button>
                  <button className="btn sm danger" onClick={() => del(d.id)}>Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={faqOpen} title="Nuova FAQ" onClose={() => setFaqOpen(false)}>
        <form onSubmit={addFaq}>
          <div className="field"><label className="label">Domanda</label><input className="input" value={faq.question} onChange={(e) => setFaq({ ...faq, question: e.target.value })} required /></div>
          <div className="field"><label className="label">Risposta</label><textarea className="textarea" value={faq.answer} onChange={(e) => setFaq({ ...faq, answer: e.target.value })} required /></div>
          <div className="field"><label className="label">Link da proporre (opzionale)</label><input className="input mono" placeholder="https://…" value={faq.link} onChange={(e) => setFaq({ ...faq, link: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary">Salva</button></div>
        </form>
      </Modal>
      <Modal open={textOpen} title="Nuovo testo" onClose={() => setTextOpen(false)}>
        <form onSubmit={addText}>
          <div className="field"><label className="label">Titolo</label><input className="input" value={txt.title} onChange={(e) => setTxt({ ...txt, title: e.target.value })} required /></div>
          <div className="field"><label className="label">Contenuto</label><textarea className="textarea" style={{ minHeight: 200 }} value={txt.content} onChange={(e) => setTxt({ ...txt, content: e.target.value })} required /></div>
          <div className="field"><label className="label">Link di riferimento (opzionale)</label><input className="input mono" placeholder="https://…" value={txt.link} onChange={(e) => setTxt({ ...txt, link: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary">Salva</button></div>
        </form>
      </Modal>
    </div>
  )
}
