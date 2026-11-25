import { useEffect, useState } from 'react'
import { supabase, callFunction } from '../../lib/supabase'
import { daysAgo, fmtDateTime, renderMessageHtml } from '../../lib/utils'
import { Toast, useToast, EmptyState, Spinner } from '../../components/ui'
import RetrievalDetails from '../../components/RetrievalDetails'

/**
 * Test questions of a client (wa_eval_questions, migration 0009). Each question runs the same retrieval + answer as
 * the chat (chat function, mode 'test', nothing stored as a conversation) and is checked automatically:
 *  - the answer contains the expected information (terms separated by commas), if given
 *  - the answer contains a link (and the expected page, if given)
 *  - the answer is not "just a link": without links there must still be real content
 */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g

export function evaluate(q, answer) {
  const text = String(answer || '')
  const urls = [...text.matchAll(LINK)].map((m) => m[2] || m[0])
  const plain = text.replace(LINK, (m, label) => label || '').replace(/\s+/g, ' ').trim()
  const terms = String(q.expected || '').split(/[,\n;]/).map((t) => t.trim()).filter(Boolean)
  const missing = terms.filter((t) => !norm(text).includes(norm(t)))
  const wantUrl = String(q.expected_url || '').trim().replace(/\/+$/, '')
  const urlOk = !wantUrl || urls.some((u) => u.replace(/#.*$/, '').replace(/\/+$/, '').startsWith(wantUrl.replace(/#.*$/, '')))
  const linkOnly = urls.length > 0 && plain.length < 90
  const checks = {
    has_link: urls.length > 0,
    not_link_only: !linkOnly,
    expected_terms: missing.length === 0,
    expected_url: urlOk,
  }
  return { pass: Object.values(checks).every(Boolean), checks, missing, urls }
}

const CHECK_LABEL = {
  not_link_only: ['Risponde con il contenuto', 'Risponde solo con un link'],
  expected_terms: ['Contiene le informazioni attese', 'Mancano informazioni attese'],
  has_link: ['Indica la pagina fonte', 'Nessun link alla pagina fonte'],
  expected_url: ['Linka la pagina attesa', 'Non linka la pagina attesa'],
}

export default function TestQuestions({ client }) {
  const [rows, setRows] = useState(null)
  const [draft, setDraft] = useState({ question: '', expected: '', expected_url: '' })
  const [running, setRunning] = useState({}) // id → true
  const [results, setResults] = useState({}) // id → { answer, retrieval }
  const [openId, setOpenId] = useState(null)
  const [toast, setToast] = useToast()

  const load = async () => {
    const { data, error } = await supabase.from('wa_eval_questions').select('*').eq('client_id', client.id).order('created_at')
    if (error) { setRows([]); setToast(/does not exist|schema cache/i.test(error.message) ? 'Esegui la migrazione 0009 per usare le domande di prova' : error.message); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [client.id])

  const add = async (e) => {
    e?.preventDefault()
    if (!draft.question.trim()) return
    const { error } = await supabase.from('wa_eval_questions').insert({ client_id: client.id, question: draft.question.trim(), expected: draft.expected.trim() || null, expected_url: draft.expected_url.trim() || null })
    if (error) return setToast(error.message)
    setDraft({ question: '', expected: '', expected_url: '' }); load()
  }
  const update = async (id, patch) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    const { error } = await supabase.from('wa_eval_questions').update(patch).eq('id', id)
    if (error) setToast(error.message)
  }
  const remove = async (id) => { await supabase.from('wa_eval_questions').delete().eq('id', id); load() }

  // starter set: the questions visitors asked most in the last 30 days
  const seed = async () => {
    const { data } = await supabase.from('wa_messages').select('content, conversation:wa_conversations!inner(client_id)')
      .eq('role', 'user').eq('conversation.client_id', client.id).gte('created_at', daysAgo(30)).limit(500)
    const freq = {}
    for (const m of data || []) { const k = String(m.content || '').trim(); if (k.length > 10 && k.length < 200) freq[k] = (freq[k] || 0) + 1 }
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([q]) => q)
    if (!top.length) return setToast('Ancora nessuna domanda dei visitatori: aggiungile a mano')
    const { error } = await supabase.from('wa_eval_questions').insert(top.map((question) => ({ client_id: client.id, question })))
    if (error) return setToast(error.message)
    setToast(`${top.length} domande aggiunte: indica le informazioni attese`); load()
  }

  const run = async (q) => {
    setRunning((r) => ({ ...r, [q.id]: true }))
    try {
      const res = await callFunction('chat', { mode: 'test', client_id: client.id, question: q.question })
      const ev = evaluate(q, res.answer)
      setResults((r) => ({ ...r, [q.id]: res }))
      await update(q.id, { last_run_at: new Date().toISOString(), last_answer: res.answer, last_pass: ev.pass, last_details: { ...ev, confident: res.confident, best: res.retrieval?.best_similarity, model: res.model } })
    } catch (e) {
      setToast(`“${q.question.slice(0, 40)}”: ${e.message}`)
    }
    setRunning((r) => ({ ...r, [q.id]: false }))
  }
  const runAll = async () => { for (const q of rows) await run(q) } // one at a time: same load as a visitor

  if (rows === null) return <Spinner />
  const done = rows.filter((r) => r.last_run_at)
  const passed = done.filter((r) => r.last_pass).length
  const busy = Object.values(running).some(Boolean)

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="card">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 640 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Domande di prova</div>
            <p className="secondary small" style={{ margin: 0 }}>
              Ogni domanda passa dalla stessa ricerca e dallo stesso modello della chat, senza creare conversazioni.
              Una risposta è promossa se contiene le informazioni attese, indica la pagina fonte e non si limita al link.
            </p>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {done.length > 0 && <span className={`badge ${passed === done.length ? 'green' : 'yellow'}`}>{passed}/{done.length} promosse</span>}
            <button className="btn primary" disabled={!rows.length || busy} onClick={runAll}>{busy ? 'In esecuzione…' : 'Esegui tutte'}</button>
          </div>
        </div>
        <form onSubmit={add} className="test-add">
          <input className="input" placeholder="Domanda, es. A che ora è il check-in?" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} aria-label="Nuova domanda" />
          <input className="input" placeholder="Informazioni attese (separate da virgola), es. 15:00, 22:00" value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} aria-label="Informazioni attese" />
          <input className="input mono" placeholder="Pagina attesa (facoltativo) https://…" value={draft.expected_url} onChange={(e) => setDraft({ ...draft, expected_url: e.target.value })} aria-label="Pagina attesa" />
          <button className="btn" disabled={!draft.question.trim()}>Aggiungi</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState icon="chat" title="Nessuna domanda di prova" action={<button className="btn" onClick={seed}>Crea dalle domande più frequenti</button>}>
            Aggiungi le domande che i visitatori fanno davvero, con le informazioni che la risposta deve contenere.
          </EmptyState>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {rows.map((q) => {
            const d = q.last_details || {}
            const live = results[q.id]
            const open = openId === q.id
            return (
              <div key={q.id} className="card tight">
                <div className="test-row">
                  <div className="col" style={{ gap: 8, minWidth: 0, flex: 1 }}>
                    <input className="input" value={q.question} onChange={(e) => setRows((r) => r.map((x) => (x.id === q.id ? { ...x, question: e.target.value } : x)))} onBlur={(e) => update(q.id, { question: e.target.value })} aria-label="Domanda" />
                    <div className="grid2" style={{ gap: 8 }}>
                      <input className="input" placeholder="Informazioni attese, separate da virgola" defaultValue={q.expected || ''} onBlur={(e) => update(q.id, { expected: e.target.value.trim() || null })} aria-label="Informazioni attese" />
                      <input className="input mono" placeholder="Pagina attesa (facoltativo)" defaultValue={q.expected_url || ''} onBlur={(e) => update(q.id, { expected_url: e.target.value.trim() || null })} aria-label="Pagina attesa" />
                    </div>
                  </div>
                  <div className="col" style={{ gap: 6, alignItems: 'flex-end', flex: 'none' }}>
                    {q.last_run_at ? <span className={`badge ${q.last_pass ? 'green' : 'red'}`}>{q.last_pass ? 'Promossa' : 'Da migliorare'}</span> : <span className="badge muted">Mai eseguita</span>}
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm" disabled={running[q.id]} onClick={() => run(q)}>{running[q.id] ? 'Esecuzione…' : 'Esegui'}</button>
                      <button className="btn sm danger" onClick={() => remove(q.id)} aria-label="Elimina la domanda">Elimina</button>
                    </div>
                  </div>
                </div>
                {q.last_run_at && (
                  <div style={{ marginTop: 10 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {Object.entries(CHECK_LABEL).map(([k, [okL, koL]]) => (d.checks && (k !== 'expected_terms' || q.expected) && (k !== 'expected_url' || q.expected_url)) ? (
                        <span key={k} className={`badge ${d.checks[k] ? 'green' : 'red'}`}>{d.checks[k] ? okL : koL}{!d.checks[k] && k === 'expected_terms' && d.missing?.length ? `: ${d.missing.join(', ')}` : ''}</span>
                      ) : null)}
                      <button className="btn sm ghost" onClick={() => setOpenId(open ? null : q.id)}>{open ? 'Nascondi risposta' : 'Vedi risposta'}</button>
                      <span className="small muted">{fmtDateTime(q.last_run_at)}</span>
                    </div>
                    {open && (
                      <div className="test-answer">
                        <div dangerouslySetInnerHTML={{ __html: renderMessageHtml(q.last_answer || '') }} />
                        {live?.retrieval ? <RetrievalDetails retrieval={live.retrieval} /> : <div className="hint">Esegui di nuovo la domanda per vedere i contenuti recuperati.</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <style>{`.test-add{display:grid;grid-template-columns:2fr 2fr 1.4fr auto;gap:8px;margin-top:16px}
@media (max-width:900px){.test-add{grid-template-columns:1fr}}
.test-row{display:flex;gap:14px;align-items:flex-start}
@media (max-width:700px){.test-row{flex-direction:column}.test-row>.col:last-child{align-items:flex-start!important}}
.test-answer{margin-top:10px;padding:12px 14px;border-radius:var(--r-section);background:var(--surfaceAlt);border:1px solid var(--border);white-space:pre-wrap;line-height:1.6}`}</style>
    </div>
  )
}
