import { useState } from 'react'

/**
 * "Perché ha risposto così": what the assistant had in front of it for one answer.
 * retrieval (migration 0009): search query, pages passed in full, every fragment with similarity / keyword / used flag.
 * Older messages only have `sources` (top 5 with similarity): shown in a reduced form.
 * Reading it: fragments that contain the answer but the reply doesn't use them → model/prompt;
 * no fragment contains the answer → data (page not crawled, text missing, needs re-indexing).
 */
const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`
const sec = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1).replace('.', ',')} s` : `${Math.round(ms)} ms`)

/** Steps of one answer (chat function, see _shared/answer.ts), in pipeline order. */
const STEP_LABEL = {
  request: 'Lettura della richiesta',
  client: 'Configurazione del cliente',
  setup: 'Conversazione e cronologia (database)',
  rewrite: 'Riscrittura della domanda',
  embedding: 'Embedding della domanda',
  search: 'Ricerca nel database',
  context: 'Pagine intere (database)',
  first_token: 'Attesa della prima parola del modello',
  generation: 'Generazione completa',
}

/**
 * Waterfall of the answer's steps: each bar starts when the step started, so steps that ran in parallel overlap.
 * `client` (optional): times measured by the browser (test questions), to show network + platform start.
 */
export function Timings({ timings, client }) {
  if (!timings?.steps?.length) return null
  const steps = timings.steps.filter((s) => STEP_LABEL[s.key])
  const end = Math.max(timings.total_ms || 0, ...steps.map((s) => s.start + s.ms), 1)
  const slowest = [...steps].filter((s) => s.key !== 'generation').sort((a, b) => b.ms - a.ms)[0]
  return (
    <div className="timings">
      <div className="why-meta">
        <span>
          {timings.first_token_ms != null && <>Prima parola dopo <b>{sec(timings.first_token_ms)}</b> · </>}
          risposta completa in <b>{sec(end)}</b> (nella funzione){timings.cold ? ' · avvio a freddo' : ''}
          {timings.region ? ` · regione funzione ${timings.region}` : ''}
        </span>
        {client && (
          <span>
            Misurato dal browser: {client.first_token_ms != null ? <>prima parola <b>{sec(client.first_token_ms)}</b>, </> : ''}totale <b>{sec(client.total_ms)}</b>
            {client.total_ms > end ? ` (rete e avvio della piattaforma: circa ${sec(client.total_ms - end)})` : ''}
          </span>
        )}
      </div>
      <ul className="tm-list" aria-label="Tempi della risposta">
        {timings.cold && timings.boot_ms > 0 && (
          <li><span className="tm-label">Avvio funzione (a freddo)</span><span className="tm-track" aria-hidden="true" /><span className="tm-ms">{sec(timings.boot_ms)}</span></li>
        )}
        {steps.map((s, i) => (
          <li key={i} className={slowest && s === slowest ? 'slow' : ''}>
            <span className="tm-label">{s.key === 'embedding' && steps.slice(0, i).some((x) => x.key === 'embedding') ? 'Embedding della domanda riscritta' : STEP_LABEL[s.key]}{s.key === 'rewrite' && timings.rewrite_model ? ` (${timings.rewrite_model.split('/')[1]})` : ''}</span>
            <span className="tm-track" aria-hidden="true">
              <span className={`tm-bar tm-${s.key}`} style={{ left: `${(s.start / end) * 100}%`, width: `max(3px, ${(s.ms / end) * 100}%)` }} />
            </span>
            <span className="tm-ms">{sec(s.ms)}</span>
          </li>
        ))}
      </ul>
      <div className="small secondary">
        {timings.model ? `Modello ${timings.model.split('/')[1] || timings.model}` : ''}
        {timings.tokens_in ? ` · ${timings.tokens_in} token in ingresso, ${timings.tokens_out || 0} in uscita` : ''}
        {timings.prompt_chars ? ` · ${Math.round(timings.prompt_chars / 100) / 10}k caratteri inviati` : ''}
        {timings.rewrite_failed ? ` · riscrittura non riuscita (${timings.rewrite_failed})` : ''}
        {timings.interrupted ? ` · risposta interrotta: ${timings.interrupted}` : ''}
      </div>
    </div>
  )
}
const linkOf = (h) => (h.url && !String(h.url).startsWith('wisi://') ? `${h.url}${h.anchor ? `#${h.anchor}` : ''}` : null)

export default function RetrievalDetails({ retrieval, sources, clientTimings }) {
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
          {retrieval?.timings ? <Timings timings={retrieval.timings} client={clientTimings} /> : retrieval && <div className="small secondary" style={{ marginTop: 8 }}>Tempi non disponibili: risposta precedente alla misurazione.</div>}
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
