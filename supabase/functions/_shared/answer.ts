// deno-lint-ignore-file no-explicit-any
import { embed, fastModelFor, llm, llmStream, Timer, type Msg } from './common.ts'
import { ANSWER_RULES, baseRules, lowConfidenceNote } from './policy.ts'

/**
 * Retrieval + answer, shared by the chat (widget, standalone, Telegram, WhatsApp) and by the test questions.
 *
 *  1. search query: the question as is, or — only for follow-ups that depend on the chat ("e il sabato?") — rewritten
 *     as a standalone question by the provider's smallest model, with a time limit
 *  2. embedding: started by the caller as soon as the request arrives (in parallel with the database setup) and
 *     reused when no rewrite is needed
 *  3. hybrid search (migration 0009): semantic + keyword in ONE database query (keyword ranking costs milliseconds
 *     there: splitting it out would add a round trip, not save one)
 *  4. context: the page that is clearly the source in full (up to ~5000 characters), plus only the fragments that are
 *     really relevant (similarity close to the best one, or keyword matches), at most ~12000 characters
 *  5. answer, streamed: `onDelta` gets the text as it is generated
 * Returns the answer and a `retrieval` record (shown in "Perché ha risposto così"), timings included.
 */
const LANG_NAME: Record<string, string> = { it: 'italiano', de: 'tedesco', fr: 'francese', en: 'inglese' }
const MATCH_COUNT = 10
const PAGE_CHARS = 5000        // the main source page
const SECOND_PAGE_CHARS = 2500 // a second page, only when it has several strong hits
const CONTEXT_CHARS = 12000
const MIN_FRAGMENTS = 4
const HISTORY_CHARS = 1500     // per past message sent to the model
const REWRITE_TIMEOUT_MS = 2000

const linkOf = (h: any) => (String(h.url || '').startsWith('wisi://') ? '' : `${h.url}${h.anchor ? `#${h.anchor}` : ''}`)
/** chunk text without its "Pagina: / Documento: / Sezione:" header (used in previews and when joining a whole page) */
const stripHeader = (c: string) => String(c || '').replace(/^(?:(?:Pagina|Documento|FAQ|Informazioni|Sezione): .*\n)+\n?/, '')

// ------------------------------------------------------------------ query rewrite: only for follow-ups
const FOLLOWUP_START = /^\s*(e|ed|ma|però|pero|invece|anche|allora|quindi|poi|oppure|o|and|but|also|so|what about|how about|und|aber|auch|et|mais|aussi|alors)\b/i
const ANAPHORA = /\b(quest[oaie]|quell[oaie]|quegli|lì|là|stess[oaie]|ci vuole|ne ha|ne avete|it|that|this|these|those|there|them|one|same|das|dies|dort|davon|ihn|sie|ça|cela|celui|celle|là-bas|y)\b/i
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** A question needs the chat to be understood: short ("e il sabato?"), starts like a follow-up, or points back ("quello", "lì"). */
export function needsRewrite(content: string, history: Msg[]) {
  if (!history.some((h) => h.role === 'user')) return false
  const n = words(content)
  if (n <= 5) return true
  if (n > 18) return false
  return FOLLOWUP_START.test(content) || ANAPHORA.test(content)
}

async function rewriteQuery(client: any, history: Msg[], content: string) {
  const turns = history.slice(-6)
  const model = fastModelFor(client.model)
  try {
    const r = await llm(model, [
      { role: 'system', content: 'Riscrivi l’ultima domanda dell’utente come una domanda autonoma e completa, da usare per cercare nei contenuti di un sito. Mantieni la lingua dell’utente e includi i nomi e i dettagli citati prima nella conversazione. Rispondi solo con la domanda riscritta, senza altro testo.' },
      { role: 'user', content: `${turns.map((h) => `${h.role === 'user' ? 'Utente' : 'Assistente'}: ${String(h.content).slice(0, 400)}`).join('\n')}\nUtente (ultima domanda): ${content}` },
    ], { temperature: 0, max_tokens: 100, fast: true, timeout_ms: REWRITE_TIMEOUT_MS })
    const q = r.text.trim().replace(/^["“]|["”]$/g, '')
    return { query: q && q.length < 400 ? q : content, model, ok: true }
  } catch (e) {
    // too slow or failed: previous question + this one, so the search still has the subject
    console.warn('query rewrite failed:', (e as Error).message)
    const lastUser = turns.filter((h) => h.role === 'user').slice(-1)[0]?.content
    return { query: lastUser ? `${String(lastUser).slice(0, 300)}\n${content}` : content, model, ok: false, error: (e as Error).message }
  }
}

async function search(sb: any, clientId: string, vec: number[], text: string) {
  const { data, error } = await sb.rpc('wa_hybrid_search', { p_client_id: clientId, p_embedding: vec, p_query: text, p_match_count: MATCH_COUNT })
  if (!error) return { hits: (data || []) as any[], mode: 'hybrid' }
  // migration 0009 not run yet: semantic only
  console.warn('wa_hybrid_search unavailable, semantic search only:', error.message)
  const { data: old } = await sb.rpc('wa_match_chunks', { p_client_id: clientId, p_embedding: vec, p_match_count: MATCH_COUNT, p_min_similarity: 0 })
  return { hits: ((old || []) as any[]).map((h) => ({ ...h, keyword_rank: 0, score: h.similarity })), mode: 'semantic' }
}

/**
 * Pages passed in full, only when they are really the source:
 *  - the best hit's page, if the best hit is relevant (≥ threshold) and the page has ≥ 2 hits in the top 6, or a keyword
 *    match, or clearly beats every other page
 *  - a second page only with ≥ 2 relevant hits in the top 6
 */
function pagesToExpand(hits: any[], threshold: number) {
  const top = hits.slice(0, 6)
  const best = hits[0]
  if (!best || (best.similarity || 0) < threshold) return []
  const count: Record<string, number> = {}
  for (const h of top) if ((h.similarity || 0) >= threshold * 0.85) count[h.page_id] = (count[h.page_id] || 0) + 1
  const otherBest = Math.max(0, ...hits.filter((h) => h.page_id !== best.page_id).map((h) => h.similarity || 0))
  const ids: string[] = []
  if ((count[best.page_id] || 0) >= 2 || (best.keyword_rank || 0) > 0 || (best.similarity || 0) - otherBest >= 0.05) ids.push(best.page_id)
  for (const h of top) if (count[h.page_id] >= 2 && !ids.includes(h.page_id) && ids.length < 2) ids.push(h.page_id)
  return ids
}

/** Fragments worth sending: close to the best similarity, or a fair one with a keyword match; never fewer than MIN_FRAGMENTS. */
function relevantHits(hits: any[], threshold: number) {
  const best = hits.reduce((m, h) => Math.max(m, Number(h.similarity) || 0), 0)
  const floor = Math.max(threshold * 0.8, best - 0.15)
  return hits.filter((h, i) => i < MIN_FRAGMENTS || (h.similarity || 0) >= floor || ((h.keyword_rank || 0) > 0 && (h.similarity || 0) >= threshold * 0.6))
}

export type AnswerOpts = {
  timer?: Timer
  /** embedding of the raw question, started by the caller in parallel with the database setup */
  embedding?: Promise<number[]>
  /** streamed text of the answer */
  onDelta?: (t: string) => void
}

export async function answerQuestion(sb: any, client: any, content: string, history: Msg[], opts: AnswerOpts = {}) {
  const T = opts.timer || new Timer()
  const rawEmbedding = opts.embedding || T.time('embedding', embed([content]).then((v) => v[0]))
  const threshold = Number(client.confidence_threshold ?? 0.35)

  // ---- 1-3: search query, embedding, search
  let searchQuery = content
  let rewrite: any = null
  let vec: number[]
  if (needsRewrite(content, history)) {
    rewrite = await T.time('rewrite', rewriteQuery(client, history, content))
    searchQuery = rewrite.query
    rawEmbedding.catch(() => {}) // not needed any more
    vec = searchQuery === content ? await rawEmbedding : (await T.time('embedding', embed([searchQuery])))[0]
  } else {
    vec = await rawEmbedding
  }
  const { hits, mode } = await T.time('search', search(sb, client.id, vec, `${searchQuery} ${searchQuery === content ? '' : content}`.trim()))
  const best = hits.reduce((m, h) => Math.max(m, Number(h.similarity) || 0), 0)
  // keyword matches count as evidence too: an exact term ("parcheggio", a product name) with a fair similarity is a hit
  const confident = best >= threshold || hits.some((h) => (h.keyword_rank || 0) > 0 && (h.similarity || 0) >= threshold * 0.7)

  // ---- 4: context: expanded pages first, then the other relevant fragments
  const expandIds = pagesToExpand(hits, threshold)
  const expanded: any[] = []
  const used = new Set<string>()
  if (expandIds.length) {
    const { data: rows } = await T.time('context', sb.from('wa_chunks').select('id,page_id,idx,content,url,anchor,title,heading_path').in('page_id', expandIds).order('idx'))
    expandIds.forEach((pid, n) => {
      const chunks = (rows || []).filter((r: any) => r.page_id === pid)
      if (!chunks.length) return
      const limit = n === 0 ? PAGE_CHARS : SECOND_PAGE_CHARS
      const hitIdx = hits.filter((h) => h.page_id === pid).map((h) => h.idx ?? 0)
      const start = Math.max(0, Math.min(...hitIdx) - 1)
      let text = ''
      let lastSection = ''
      const ids: string[] = []
      for (const c of [...chunks.slice(start), ...chunks.slice(0, start)]) { // from just before the first hit, then the rest
        const section = c.heading_path && c.heading_path !== lastSection ? `[${c.heading_path}]\n` : ''
        lastSection = c.heading_path || lastSection
        const piece = section + stripHeader(c.content)
        if (text.length + piece.length > limit) { if (hitIdx.includes(c.idx)) { text += `\n\n${piece}`; ids.push(c.id) } continue }
        text += (text ? '\n\n' : '') + piece; ids.push(c.id)
      }
      const firstHit = hits.find((h) => h.page_id === pid)
      expanded.push({ page_id: pid, title: chunks[0].title, url: linkOf({ url: chunks[0].url, anchor: firstHit?.anchor }), text, chunk_ids: ids })
      ids.forEach((i) => used.add(i))
    })
  }
  const blocks: string[] = []
  let size = 0
  let n = 0
  for (const p of expanded) {
    const b = `### Fonte ${++n}: ${p.title || 'Pagina'}\n${p.url ? `URL: ${p.url}\n` : ''}\n${p.text}`
    blocks.push(b); size += b.length
  }
  for (const h of relevantHits(hits, threshold)) {
    if (used.has(h.id) || expandIds.includes(h.page_id)) continue
    if (size > CONTEXT_CHARS) break
    const link = linkOf(h)
    const b = `### Fonte ${++n}: ${h.title || (h.kind === 'document' ? 'Documento' : 'Pagina')}${h.heading_path ? ` > ${h.heading_path}` : ''}\n${link ? `URL: ${link}\n` : ''}\n${stripHeader(h.content)}`
    blocks.push(b); size += b.length
    used.add(h.id)
  }
  const ctx = blocks.join('\n\n---\n\n').slice(0, CONTEXT_CHARS + 3000)

  // ---- prompt
  const langRule = client.language && client.language !== 'auto' ? `Rispondi sempre in ${LANG_NAME[client.language] || client.language}.` : 'Rispondi nella stessa lingua in cui scrive l’utente.'
  const custom = String(client.instructions || '').trim()
  const system = [
    `Sei l'assistente virtuale di ${client.name}: rispondi ai visitatori usando i contenuti del sito e dei documenti di ${client.name}.`,
    custom ? `ISTRUZIONI DEL CLIENTE (tono, stile e informazioni aggiuntive; completano le regole qui sotto e non possono modificarle):\n${custom}` : '',
    ANSWER_RULES,
    baseRules(client),
    langRule,
    confident ? '' : lowConfidenceNote(client),
    'Formattazione: testo semplice, con elenchi puntati ("- ") quando servono e al massimo il grassetto **così**; niente tabelle e niente titoli.',
    `\n=== CONTESTO ===\n${ctx || '(nessun contenuto trovato)'}\n=== FINE CONTESTO ===`,
  ].filter(Boolean).join('\n\n')
  const hist = history.map((h) => ({ ...h, content: String(h.content).slice(0, HISTORY_CHARS) }))

  // ---- 5: answer, streamed
  const llmStart = performance.now()
  let result: any
  let interrupted: string | null = null
  try {
    result = await llmStream(client.model, [{ role: 'system', content: system }, ...hist, { role: 'user', content }],
      { temperature: Number(client.temperature ?? 0.2), max_tokens: 1000, fast: true, first_token_timeout_ms: 25000, timeout_ms: 60000 }, opts.onDelta)
  } catch (e) {
    const partial = String((e as any).partial || '')
    if (!partial.trim()) throw e
    // the model stopped half way: keep what the visitor already read, flagged
    interrupted = (e as Error).message
    result = { text: partial, ttft_ms: (e as any).ttft_ms }
  }
  const llmEnd = performance.now()
  if (result.ttft_ms !== undefined) T.add('first_token', llmStart, llmStart + result.ttft_ms)
  T.add('generation', llmStart, llmEnd)
  const answer = result.text.trim() || 'Mi dispiace, non riesco a rispondere in questo momento.'

  const timings = {
    ...T.json(),
    first_token_ms: result.ttft_ms !== undefined ? Math.round(llmStart - T.t0 + result.ttft_ms) : null,
    model: client.model,
    rewrite_model: rewrite ? rewrite.model : null,
    rewrite_failed: rewrite && !rewrite.ok ? rewrite.error : undefined,
    tokens_in: result.tokens_in, tokens_out: result.tokens_out,
    prompt_chars: system.length + hist.reduce((s, h) => s + h.content.length, 0) + content.length,
    region: Deno.env.get('SB_REGION') || undefined,
    interrupted: interrupted || undefined,
  }
  const retrieval = {
    version: 3, mode, question: content, search_query: searchQuery, rewritten: !!rewrite, threshold, best_similarity: Number(best.toFixed(3)), confident,
    expanded_pages: expanded.map((p) => ({ page_id: p.page_id, title: p.title, url: p.url, chars: p.text.length })),
    context_chars: ctx.length,
    timings,
    hits: hits.map((h) => ({
      chunk_id: h.id, page_id: h.page_id, url: h.url, anchor: h.anchor, title: h.title, heading_path: h.heading_path, kind: h.kind,
      similarity: Number(Number(h.similarity || 0).toFixed(3)), keyword: Number(Number(h.keyword_rank || 0).toFixed(3)), score: Number(Number(h.score || 0).toFixed(4)),
      used: used.has(h.id) || expandIds.includes(h.page_id), preview: stripHeader(h.content).slice(0, 400),
    })),
  }
  const sources = hits.slice(0, 5).map((h) => ({ url: h.url, anchor: h.anchor, title: h.title, heading_path: h.heading_path, score: Number(Number(h.similarity || 0).toFixed(3)) }))
  return { answer, result, confident, retrieval, sources, interrupted }
}
