import { useState } from 'react'

/**
 * "Perché ha risposto così": what the assistant had in front of it for one answer.
 * retrieval (migration 0009): search query, pages passed in full, every fragment with similarity / keyword / used flag.
 * Older messages only have `sources` (top 5 with similarity): shown in a reduced form.
 * Reading it: fragments that contain the answer but the reply doesn't use them → model/prompt;
 * no fragment contains the answer → data (page not crawled, text missing, needs re-indexing).
 */
const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`
const linkOf = (h) => (h.url && !String(h.url).startsWith('wisi://') ? `${h.url}${h.anchor ? `#${h.anchor}` : ''}` : null)

export default function RetrievalDetails({ retrieval, sources }) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(null)
  if (!retrieval && !sources?.length) return null
  const hits = retrieval?.hits || (sources || []).map((s) => ({ ...s, similarity: s.score, used: true }))
  return (
    <div className="why">
      <button type="button" className="why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Nascondi' : 'Perché ha risposto così'}
      </button>
      {open && (
        <div className="why-body">
          {retrieval ? (
            <div className="why-meta">
              <span>Ricerca: <b>“{retrieval.search_query}”</b>{retrieval.search_query !== retrieval.question ? ' (riscritta dalla chat)' : ''}</span>
              <span>Miglior corrispondenza: <b>{pct(retrieval.best_similarity)}</b> (soglia {pct(retrieval.threshold)}) {retrieval.confident ? <span className="badge green">Pertinente</span> : <span className="badge yellow">Poco pertinente</span>}</span>
              <span>Ricerca {retrieval.mode === 'hybrid' ? 'ibrida (significato + parole chiave)' : 'solo semantica (migrazione 0009 da eseguire)'} · {Math.round((retrieval.context_chars || 0) / 100) / 10}k caratteri passati al modello</span>
            </div>
          ) : <div className="why-meta"><span>Risposta precedente all’aggiornamento: sono disponibili solo le pagine principali.</span></div>}
          {retrieval?.expanded_pages?.length > 0 && (
            <div className="small" style={{ margin: '8px 0' }}>
              Pagine passate per intero: {retrieval.expanded_pages.map((p, i) => (
                <span key={p.page_id}>{i ? ', ' : ''}{p.url ? <a href={p.url} target="_blank" rel="noopener">{p.title || p.url}</a> : p.title} ({Math.round(p.chars / 100) / 10}k)</span>
              ))}
            </div>
          )}
          <ol className="why-hits">
            {hits.map((h, i) => {
              const link = linkOf(h)
              return (
                <li key={h.chunk_id || i} className={h.used ? '' : 'unused'}>
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <span className="small" style={{ minWidth: 0 }}>
                      <b style={{ color: 'var(--heading)' }}>{h.title || (h.kind === 'document' ? 'Documento' : 'Pagina')}</b>
                      {h.heading_path ? <span className="secondary"> › {h.heading_path}</span> : null}
                      {link && <> · <a href={link} target="_blank" rel="noopener">apri</a></>}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="badge" title="Somiglianza di significato con la domanda">{pct(h.similarity)}</span>
                      {h.keyword > 0 && <span className="badge green" title="Contiene parole della domanda">parole chiave</span>}
                      {!h.used && <span className="badge muted" title="Non passato al modello (contesto pieno)">non usato</span>}
                    </span>
                  </div>
                  {h.preview && (
                    <div className="why-preview">
                      {full === i ? h.preview : `${h.preview.slice(0, 180)}${h.preview.length > 180 ? '…' : ''}`}
                      {h.preview.length > 180 && <button type="button" className="why-more" onClick={() => setFull(full === i ? null : i)}>{full === i ? 'meno' : 'tutto'}</button>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          {!hits.length && <div className="small secondary">Nessun contenuto trovato: il cliente non ha pagine o documenti indicizzati su questo argomento.</div>}
        </div>
      )}
    </div>
  )
}
