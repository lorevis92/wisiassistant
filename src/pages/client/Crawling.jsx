import { useEffect, useMemo, useState } from 'react'
import { supabase, callCrawler } from '../../lib/supabase'
import { StatusBadge, Toast, useToast, Modal } from '../../components/ui'
import { fmtDateTime, matchesPattern, urlPathPrefixes } from '../../lib/utils'

/**
 * Flow:
 *  1. MAP   → the crawler discovers every URL of the domain (sitemap + links) without downloading content.
 *  2. SELECT → filter / group by prefix / exclude patterns; save include/exclude rules for future re-crawls.
 *  3. CRAWL → only selected URLs are fetched, cleaned, chunked (with heading hierarchy + anchors) and embedded.
 *  Afterwards: manage indexed pages (toggle, delete by pattern, re-crawl single pages).
 */
export default function Crawling({ client, reload }) {
  const [tab, setTab] = useState('pages') // pages | discover
  const [toast, setToast] = useToast()

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="row between wrap">
        <div className="tabs">
          <button className={`tab ${tab === 'pages' ? 'active' : ''}`} onClick={() => setTab('pages')}>Pagine indicizzate</button>
          <button className={`tab ${tab === 'discover' ? 'active' : ''}`} onClick={() => setTab('discover')}>Scopri & crawla</button>
        </div>
        <RulesEditor client={client} reload={reload} setToast={setToast} />
      </div>
      {tab === 'pages' ? <IndexedPages client={client} setToast={setToast} /> : <Discover client={client} reload={reload} setToast={setToast} />}
    </div>
  )
}

/* ---------------------------------- RULES ---------------------------------- */
function RulesEditor({ client, reload, setToast }) {
  const [open, setOpen] = useState(false)
  const [inc, setInc] = useState((client.include_patterns || []).join('\n'))
  const [exc, setExc] = useState((client.exclude_patterns || []).join('\n'))
  const save = async () => {
    const toList = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean)
    const { error } = await supabase.from('wa_clients').update({ include_patterns: toList(inc), exclude_patterns: toList(exc) }).eq('id', client.id)
    if (error) return setToast(error.message)
    setToast('Regole salvate'); setOpen(false); reload()
  }
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Regole include/exclude ({(client.include_patterns || []).length + (client.exclude_patterns || []).length})</button>
      <Modal open={open} title="Regole di crawling" onClose={() => setOpen(false)}>
        <div className="hint" style={{ marginBottom: 12 }}>
          Una regola per riga. Usa <span className="mono">*</span> come jolly. Le regole che iniziano con <span className="mono">/</span> si applicano al percorso, altrimenti all’URL completo.
          Vengono applicate automaticamente ad ogni mapping e re-crawl. Le regole di esclusione vincono su quelle di inclusione.
        </div>
        <div className="field">
          <label className="label">Includi solo (vuoto = tutto)</label>
          <textarea className="textarea mono" value={inc} onChange={(e) => setInc(e.target.value)} placeholder={'/it/*\n/prodotti/*'} />
        </div>
        <div className="field">
          <label className="label">Escludi</label>
          <textarea className="textarea mono" value={exc} onChange={(e) => setExc(e.target.value)} placeholder={'/blog/*\n/tag/*\n*?page=*\n/wp-admin/*'} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setOpen(false)}>Annulla</button>
          <button className="btn primary" onClick={save}>Salva regole</button>
        </div>
      </Modal>
    </>
  )
}

/* --------------------------------- DISCOVER -------------------------------- */
function Discover({ client, reload, setToast }) {
  const [startUrl, setStartUrl] = useState(client.domain || '')
  const [mapping, setMapping] = useState(false)
  const [urls, setUrls] = useState([])          // discovered
  const [indexed, setIndexed] = useState(new Set())
  const [selected, setSelected] = useState(new Set())
  const [q, setQ] = useState('')
  const [prefix, setPrefix] = useState('')
  const [job, setJob] = useState(null)
  const [extraExc, setExtraExc] = useState([])  // session-only exclusions (not saved unless user clicks)

  useEffect(() => {
    supabase.from('wa_pages').select('url').eq('client_id', client.id).then(({ data }) => setIndexed(new Set((data || []).map((p) => p.url))))
  }, [client.id])

  // Live job progress
  useEffect(() => {
    const ch = supabase.channel(`jobs-${client.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_crawl_jobs', filter: `client_id=eq.${client.id}` }, (p) => {
        setJob(p.new)
        if (p.new?.status === 'done' || p.new?.status === 'error') { reload() }
      }).subscribe()
    supabase.from('wa_crawl_jobs').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setJob(data))
    return () => { supabase.removeChannel(ch) }
  }, [client.id])

  const excluded = (u) => (client.exclude_patterns || []).concat(extraExc).some((p) => matchesPattern(u, p))
  const included = (u) => !(client.include_patterns || []).length || client.include_patterns.some((p) => matchesPattern(u, p))

  const visible = useMemo(() => {
    const ql = q.toLowerCase()
    return urls.filter((u) => (!ql || u.toLowerCase().includes(ql)) && (!prefix || matchesPattern(u, prefix)))
  }, [urls, q, prefix])

  const prefixes = useMemo(() => urlPathPrefixes(urls), [urls])

  const runMap = async () => {
    setMapping(true); setUrls([]); setSelected(new Set())
    try {
      const r = await callCrawler('/map', { client_id: client.id, url: startUrl })
      const list = r.urls || []
      setUrls(list)
      const sel = new Set(list.filter((u) => included(u) && !excluded(u) && !indexed.has(u)))
      setSelected(sel)
      setToast(`${list.length} URL trovati · ${sel.size} selezionati`)
    } catch (e) { setToast(e.message) }
    setMapping(false)
  }

  const toggle = (u) => { const s = new Set(selected); s.has(u) ? s.delete(u) : s.add(u); setSelected(s) }
  const selectVisible = (on) => { const s = new Set(selected); visible.forEach((u) => (on ? s.add(u) : s.delete(u))); setSelected(s) }
  const excludePrefix = (p) => { setExtraExc([...extraExc, `${p}*`]); const s = new Set(selected); urls.forEach((u) => { if (matchesPattern(u, `${p}*`)) s.delete(u) }); setSelected(s) }
  const saveExtraExc = async () => {
    const merged = Array.from(new Set([...(client.exclude_patterns || []), ...extraExc]))
    await supabase.from('wa_clients').update({ exclude_patterns: merged }).eq('id', client.id)
    setExtraExc([]); reload(); setToast('Esclusioni salvate nelle regole')
  }

  const runCrawl = async () => {
    const list = Array.from(selected)
    if (!list.length) return setToast('Seleziona almeno una pagina')
    try {
      await callCrawler('/crawl', { client_id: client.id, urls: list })
      setToast(`Crawl avviato su ${list.length} pagine`)
    } catch (e) { setToast(e.message) }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-title">1 · Scopri le pagine del sito</div>
        <div className="row">
          <input className="input mono" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://www.esempio.ch" />
          <button className="btn primary" disabled={mapping || !startUrl} onClick={runMap}>{mapping ? 'Mapping…' : 'Mappa il sito'}</button>
        </div>
        <div className="hint">Il mapping legge sitemap e link interni senza scaricare i contenuti: è veloce anche su siti con migliaia di pagine. Le pagine già indicizzate non vengono riselezionate.</div>
      </div>

      {job && (job.status === 'running' || job.status === 'queued') && <JobProgress job={job} />}
      {job && job.status === 'done' && <div className="card tight row between"><span>Ultimo crawl: <b>{job.done_count}</b> pagine ok · {job.error_count} errori · {fmtDateTime(job.finished_at)}</span><StatusBadge status="ok" /></div>}
      {job && job.status === 'error' && <div className="card tight row between"><span>Errore crawl: {job.error}</span><StatusBadge status="failed" /></div>}

      {urls.length > 0 && (
        <div className="card">
          <div className="card-title">2 · Seleziona cosa indicizzare</div>

          <div className="row wrap" style={{ marginBottom: 10 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Cerca negli URL…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" style={{ maxWidth: 260 }} value={prefix} onChange={(e) => setPrefix(e.target.value)}>
              <option value="">Tutti i gruppi</option>
              {prefixes.map(([p, n]) => <option key={p} value={`${p}*`}>{p} ({n})</option>)}
            </select>
            <button className="btn sm" onClick={() => selectVisible(true)}>Seleziona visibili</button>
            <button className="btn sm" onClick={() => selectVisible(false)}>Deseleziona visibili</button>
            {prefix && <button className="btn sm danger" onClick={() => { excludePrefix(prefix.replace(/\*$/, '')); setPrefix('') }}>Escludi gruppo {prefix}</button>}
          </div>

          <div className="row wrap" style={{ marginBottom: 10 }}>
            <span className="small secondary">Gruppi:</span>
            {prefixes.slice(0, 14).map(([p, n]) => (
              <span key={p} className="chip">
                <span style={{ cursor: 'pointer' }} onClick={() => setPrefix(`${p}*`)}>{p} <span className="muted">{n}</span></span>
                <button title="Escludi questo gruppo" onClick={() => excludePrefix(p)}>✕</button>
              </span>
            ))}
          </div>

          {extraExc.length > 0 && (
            <div className="row wrap" style={{ marginBottom: 10 }}>
              <span className="small secondary">Esclusioni di questa sessione:</span>
              {extraExc.map((p) => <span key={p} className="chip">{p}<button onClick={() => setExtraExc(extraExc.filter((x) => x !== p))}>✕</button></span>)}
              <button className="btn sm" onClick={saveExtraExc}>Salva nelle regole</button>
            </div>
          )}

          <div style={{ maxHeight: 440, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
            <table className="table">
              <thead><tr><th style={{ width: 30 }}></th><th>URL</th><th style={{ width: 110 }}>Stato</th></tr></thead>
              <tbody>
                {visible.slice(0, 2000).map((u) => {
                  const ex = excluded(u); const idx = indexed.has(u)
                  return (
                    <tr key={u} style={{ opacity: ex ? 0.45 : 1 }}>
                      <td><input type="checkbox" className="checkbox" checked={selected.has(u)} onChange={() => toggle(u)} /></td>
                      <td className="mono"><span className="truncate" style={{ maxWidth: 700 }}>{u}</span></td>
                      <td>{ex ? <span className="badge muted">Escluso</span> : idx ? <span className="badge green">Indicizzato</span> : <span className="badge">Nuovo</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row between" style={{ marginTop: 12 }}>
            <span className="small secondary">{visible.length} visibili · {urls.length} totali · <b>{selected.size}</b> selezionati</span>
            <button className="btn primary" disabled={!selected.size || job?.status === 'running'} onClick={runCrawl}>3 · Crawla {selected.size} pagine</button>
          </div>
        </div>
      )}
    </div>
  )
}

function JobProgress({ job }) {
  const pct = job.total_count ? Math.round(((job.done_count + job.error_count) / job.total_count) * 100) : 0
  return (
    <div className="card tight">
      <div className="row between" style={{ marginBottom: 8 }}>
        <span><StatusBadge status="crawling" /> <span className="mono small">{job.done_count + job.error_count}/{job.total_count}</span> · {job.current_url ? <span className="mono small secondary">{job.current_url}</span> : null}</span>
        <span className="mono small">{pct}%</span>
      </div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/* ------------------------------ INDEXED PAGES ------------------------------ */
function IndexedPages({ client, setToast }) {
  const [pages, setPages] = useState(null)
  const [q, setQ] = useState('')
  const [prefix, setPrefix] = useState('')
  const [sel, setSel] = useState(new Set())
  const [sort, setSort] = useState('url')

  const load = async () => {
    const { data } = await supabase.from('wa_pages').select('id,url,title,status,chunk_count,enabled,last_crawled_at,error,word_count').eq('client_id', client.id).order('url')
    setPages(data || [])
  }
  useEffect(() => { load() }, [client.id])
  useEffect(() => {
    const ch = supabase.channel(`pages-${client.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_pages', filter: `client_id=eq.${client.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [client.id])

  const urls = useMemo(() => (pages || []).map((p) => p.url), [pages])
  const prefixes = useMemo(() => urlPathPrefixes(urls), [urls])
  const visible = useMemo(() => {
    const ql = q.toLowerCase()
    let list = (pages || []).filter((p) => (!ql || p.url.toLowerCase().includes(ql) || (p.title || '').toLowerCase().includes(ql)) && (!prefix || matchesPattern(p.url, prefix)))
    if (sort === 'chunks') list = [...list].sort((a, b) => (b.chunk_count || 0) - (a.chunk_count || 0))
    if (sort === 'date') list = [...list].sort((a, b) => new Date(b.last_crawled_at || 0) - new Date(a.last_crawled_at || 0))
    return list
  }, [pages, q, prefix, sort])

  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s) }
  const ids = () => Array.from(sel)

  const del = async (list) => {
    if (!list.length) return
    if (!confirm(`Eliminare ${list.length} pagine e i relativi chunk?`)) return
    const { error } = await supabase.from('wa_pages').delete().in('id', list)
    if (error) return setToast(error.message)
    setSel(new Set()); setToast(`${list.length} pagine eliminate`); load()
  }
  const setEnabled = async (list, enabled) => {
    await supabase.from('wa_pages').update({ enabled }).in('id', list)
    setSel(new Set()); load()
  }
  const recrawl = async (list) => {
    const urlsToCrawl = (pages || []).filter((p) => list.includes(p.id)).map((p) => p.url)
    try { await callCrawler('/crawl', { client_id: client.id, urls: urlsToCrawl }); setToast(`Re-crawl avviato su ${urlsToCrawl.length} pagine`) } catch (e) { setToast(e.message) }
    setSel(new Set())
  }
  const deleteByPattern = async () => {
    const pat = prompt('Elimina tutte le pagine il cui URL inizia con (es. /blog/ oppure https://sito.ch/en/):')
    if (!pat) return
    const list = (pages || []).filter((p) => matchesPattern(p.url, `${pat}*`)).map((p) => p.id)
    if (!list.length) return setToast('Nessuna pagina corrisponde')
    await del(list)
  }

  const totalChunks = (pages || []).reduce((a, p) => a + (p.chunk_count || 0), 0)

  return (
    <div className="card">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div className="row wrap">
          <input className="input" style={{ maxWidth: 280 }} placeholder="Cerca URL o titolo…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ maxWidth: 230 }} value={prefix} onChange={(e) => setPrefix(e.target.value)}>
            <option value="">Tutti i gruppi</option>
            {prefixes.map(([p, n]) => <option key={p} value={`${p}*`}>{p} ({n})</option>)}
          </select>
          <select className="select" style={{ maxWidth: 170 }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="url">Ordina: URL</option>
            <option value="chunks">Ordina: più pesanti</option>
            <option value="date">Ordina: più recenti</option>
          </select>
        </div>
        <span className="small secondary">{(pages || []).length} pagine · {totalChunks} chunk</span>
      </div>

      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => setSel(new Set(visible.map((p) => p.id)))}>Seleziona visibili</button>
        <button className="btn sm" onClick={() => setSel(new Set())}>Nessuno</button>
        <button className="btn sm" disabled={!sel.size} onClick={() => recrawl(ids())}>Re-crawl ({sel.size})</button>
        <button className="btn sm" disabled={!sel.size} onClick={() => setEnabled(ids(), false)}>Disattiva</button>
        <button className="btn sm" disabled={!sel.size} onClick={() => setEnabled(ids(), true)}>Attiva</button>
        <button className="btn sm danger" disabled={!sel.size} onClick={() => del(ids())}>Elimina ({sel.size})</button>
        <button className="btn sm danger" onClick={deleteByPattern}>Elimina per prefisso…</button>
        {prefix && <button className="btn sm danger" onClick={() => del(visible.map((p) => p.id))}>Elimina gruppo {prefix}</button>}
      </div>

      {pages === null ? <div className="empty">Caricamento…</div> : pages.length === 0 ? (
        <div className="empty">Nessuna pagina indicizzata. Vai su “Scopri & crawla”.</div>
      ) : (
        <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
          <table className="table">
            <thead><tr><th style={{ width: 30 }}></th><th>URL / titolo</th><th>Stato</th><th>Chunk</th><th>Parole</th><th>Ultimo crawl</th><th></th></tr></thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} style={{ opacity: p.enabled ? 1 : 0.5 }}>
                  <td><input type="checkbox" className="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td>
                    <a className="mono truncate" href={p.url} target="_blank" rel="noopener" style={{ maxWidth: 520, color: 'var(--text)' }}>{p.url}</a>
                    <div className="small secondary truncate" style={{ maxWidth: 520 }}>{p.title || ''}{p.error ? ` · ${p.error}` : ''}</div>
                  </td>
                  <td>{p.enabled ? <StatusBadge status={p.status} /> : <span className="badge muted">Disattiva</span>}</td>
                  <td className="mono">{p.chunk_count || 0}</td>
                  <td className="mono">{p.word_count || 0}</td>
                  <td className="mono small">{fmtDateTime(p.last_crawled_at)}</td>
                  <td><button className="btn sm ghost" onClick={() => recrawl([p.id])}>↻</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
