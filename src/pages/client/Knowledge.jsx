import { useEffect, useState } from 'react'
import { supabase, callFunction } from '../../lib/supabase'
import { StatusBadge, Toast, useToast, Modal, EmptyState, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/utils'
import DocumentUploader from '../../components/DocumentUploader'

/** Manual knowledge: PDF / text / FAQ entries. Each becomes a "page" of kind 'document' or 'faq' and gets chunked+embedded by the `ingest` function. */
export default function Knowledge({ client }) {
  const [docs, setDocs] = useState(null)
  const [toast, setToast] = useToast()
  const [faqOpen, setFaqOpen] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const [faq, setFaq] = useState({ question: '', answer: '', link: '' })
  const [txt, setTxt] = useState({ title: '', content: '', link: '' })

  const load = async () => {
    const { data } = await supabase.from('wa_pages').select('id,url,title,kind,status,chunk_count,enabled,last_crawled_at,error,created_at')
      .eq('client_id', client.id).in('kind', ['document', 'faq', 'text']).order('created_at', { ascending: false })
    setDocs(data || [])
  }
  useEffect(() => { load() }, [client.id])
  useEffect(() => {
    const ch = supabase.channel(`kb-${client.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_pages', filter: `client_id=eq.${client.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [client.id])

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
  const del = async (id) => { if (confirm('Eliminare?')) { await supabase.from('wa_pages').delete().eq('id', id); load() } }
  const toggle = async (d) => { await supabase.from('wa_pages').update({ enabled: !d.enabled }).eq('id', d.id); load() }
  const KIND = { document: 'Documento', faq: 'FAQ', text: 'Testo' }
  const counts = (docs || []).reduce((a, d) => ({ ...a, [d.kind]: (a[d.kind] || 0) + 1 }), {})

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="kb-grid">
        <div className="card">
          <div className="card-title">Documenti</div>
          <p className="card-sub">Listini, condizioni, manuali. Ogni file viene diviso in sezioni e l’assistente lo usa insieme al sito.</p>
          <DocumentUploader clientId={client.id} onUploaded={load} />
        </div>
        <div className="col" style={{ gap: 16 }}>
          <button type="button" className="card kb-action" onClick={() => setFaqOpen(true)}>
            <span className="kb-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></svg></span>
            <span><b>Aggiungi una FAQ</b><span className="small secondary">Risposte che sul sito non ci sono: orari, politiche, promozioni. Puoi allegare un link.</span></span>
          </button>
          <button type="button" className="card kb-action" onClick={() => setTextOpen(true)}>
            <span className="kb-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 6h14M5 11h14M5 16h9" /></svg></span>
            <span><b>Aggiungi un testo libero</b><span className="small secondary">Informazioni generali sul cliente che l’assistente deve conoscere.</span></span>
          </button>
        </div>
      </div>
      <style>{`.kb-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr);gap:16px;align-items:start}
@media (max-width:900px){.kb-grid{grid-template-columns:1fr}}
.kb-action{display:flex;gap:14px;align-items:flex-start;text-align:left;cursor:pointer;font:inherit;color:inherit;width:100%;transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease),transform var(--t-fast) var(--ease)}
.kb-action:hover{border-color:var(--primaryBorder);box-shadow:var(--shadow-2)}
.kb-action:active{transform:translateY(1px)}
.kb-action b{display:block;font-family:var(--font-display);font-size:var(--fs-lg);font-weight:600;margin-bottom:4px}
.kb-action .small{display:block}
.kb-icon{flex:none;width:40px;height:40px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;background:var(--primaryLight);color:var(--primary)}`}</style>

      <div className="card flush">
        <div className="pane-head">
          <span className="section-label">Contenuti aggiunti a mano</span>
          {docs?.length > 0 && <span className="small muted">{['document', 'faq', 'text'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k === 'faq' ? 'FAQ' : KIND[k].toLowerCase()}`).join(', ')}</span>}
        </div>
        {docs === null ? <Spinner /> : docs.length === 0 ? (
          <EmptyState icon="doc" title="Nessun contenuto aggiunto a mano">Carica un documento o scrivi una FAQ: l’assistente lo userà subito nelle risposte.</EmptyState>
        ) : (
        <table className="table">
          <thead><tr><th>Titolo</th><th>Tipo</th><th>Stato</th><th>Sezioni</th><th>Aggiunto</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} style={{ opacity: d.enabled ? 1 : 0.5 }}>
                <td><span className="truncate" style={{ maxWidth: 420, fontWeight: 500 }}>{d.title}</span>{d.error && <div className="small" style={{ color: 'var(--danger)' }}>{d.error}</div>}</td>
                <td><span className="badge">{KIND[d.kind] || d.kind}</span></td>
                <td><StatusBadge status={d.status} /></td>
                <td className="mono">{d.chunk_count || 0}</td>
                <td className="mono small">{fmtDateTime(d.created_at)}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn sm ghost" onClick={() => toggle(d)}>{d.enabled ? 'Disattiva' : 'Attiva'}</button>
                    <button className="btn sm danger" onClick={() => del(d.id)}>Elimina</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      <Modal open={faqOpen} title="Nuova FAQ" onClose={() => setFaqOpen(false)}>
        <form onSubmit={addFaq}>
          <div className="field"><label className="label">Domanda</label><input className="input" value={faq.question} onChange={(e) => setFaq({ ...faq, question: e.target.value })} required /></div>
          <div className="field"><label className="label">Risposta</label><textarea className="textarea" value={faq.answer} onChange={(e) => setFaq({ ...faq, answer: e.target.value })} required /></div>
          <div className="field"><label className="label">Link da proporre (opzionale)</label><input className="input mono" placeholder="https://…" value={faq.link} onChange={(e) => setFaq({ ...faq, link: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setFaqOpen(false)}>Annulla</button><button className="btn primary">Aggiungi FAQ</button></div>
        </form>
      </Modal>
      <Modal open={textOpen} title="Nuovo testo" onClose={() => setTextOpen(false)}>
        <form onSubmit={addText}>
          <div className="field"><label className="label">Titolo</label><input className="input" value={txt.title} onChange={(e) => setTxt({ ...txt, title: e.target.value })} required /></div>
          <div className="field"><label className="label">Contenuto</label><textarea className="textarea" style={{ minHeight: 200 }} value={txt.content} onChange={(e) => setTxt({ ...txt, content: e.target.value })} required /></div>
          <div className="field"><label className="label">Link di riferimento (opzionale)</label><input className="input mono" placeholder="https://…" value={txt.link} onChange={(e) => setTxt({ ...txt, link: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setTextOpen(false)}>Annulla</button><button className="btn primary">Aggiungi testo</button></div>
        </form>
      </Modal>
    </div>
  )
}
