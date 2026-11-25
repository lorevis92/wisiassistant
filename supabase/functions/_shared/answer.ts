// deno-lint-ignore-file no-explicit-any
import { embed, llm, type Msg } from './common.ts'
import { ANSWER_RULES, baseRules, lowConfidenceNote } from './policy.ts'

/**
 * Retrieval + answer, shared by the chat (widget, standalone, Telegram, WhatsApp) and by the test questions.
 *
 *  1. search query: the question, rewritten as a standalone question when the chat already has turns
 *     ("e il sabato?" → "Orari di apertura il sabato")
 *  2. hybrid search (migration 0009): semantic + keyword, fused; 14 chunks, no similarity cut-off
 *  3. page expansion: when a page is clearly the source (best hit, or several hits on the same page) the model gets
 *     that page's text (up to ~7000 characters around the hits), not a single fragment
 *  4. system prompt: client identity and instructions, then ANSWER_RULES (they prevail), contact rules, language, context
 * Returns the answer and a `retrieval` record (shown in "Perché ha risposto così").
 */
const LANG_NAME: Record<string, string> = { it: 'italiano', de: 'tedesco', fr: 'francese', en: 'inglese' }
const MATCH_COUNT = 14
const PAGE_CHARS = 7000
const CONTEXT_CHARS = 20000

const linkOf = (h: any) => (String(h.url || '').startsWith('wisi://') ? '' : `${h.url}${h.anchor ? `#${h.anchor}` : ''}`)
/** chunk text without its "Pagina: / Documento: / Sezione:" header (used in previews and when joining a whole page) */
const stripHeader = (c: string) => String(c || '').replace(/^(?:(?:Pagina|Documento|FAQ|Informazioni|Sezione): .*\n)+\n?/, '')

async function rewriteQuery(client: any, history: Msg[], content: string): Promise<string> {
  const turns = history.slice(-6)
  if (!turns.some((h) => h.role === 'user')) return content
  try {
    const r = await llm(client.model, [
      { role: 'system', content: 'Riscrivi l’ultima domanda dell’utente come una domanda autonoma e completa, da usare per cercare nei contenuti di un sito. Mantieni la lingua dell’utente e includi i nomi e i dettagli citati prima nella conversazione. Rispondi solo con la domanda riscritta, senza altro testo.' },
      { role: 'user', content: `${turns.map((h) => `${h.role === 'user' ? 'Utente' : 'Assistente'}: ${String(h.content).slice(0, 600)}`).join('\n')}\nUtente (ultima domanda): ${content}` },
    ], { temperature: 0, max_tokens: 120 })
    const q = r.text.trim().replace(/^["“]|["”]$/g, '')
    return q && q.length < 400 ? q : content
  } catch (e) {
    console.warn('query rewrite failed:', (e as Error).message)
    const lastUser = turns.filter((h) => h.role === 'user').slice(-1)[0]?.content
    return lastUser && content.length < 60 ? `${lastUser}\n${content}` : content
  }
}

async function search(sb: any, clientId: string, query: string, extra: string) {
  const [vec] = await embed([query])
  const { data, error } = await sb.rpc('wa_hybrid_search', { p_client_id: clientId, p_embedding: vec, p_query: `${query} ${extra}`.trim(), p_match_count: MATCH_COUNT })
  if (!error) return { hits: (data || []) as any[], mode: 'hybrid' }
  // migration 0009 not run yet: semantic only
  console.warn('wa_hybrid_search unavailable, semantic search only:', error.message)
  const { data: old } = await sb.rpc('wa_match_chunks', { p_client_id: clientId, p_embedding: vec, p_match_count: MATCH_COUNT, p_min_similarity: 0 })
  return { hits: ((old || []) as any[]).map((h) => ({ ...h, keyword_rank: 0, score: h.similarity })), mode: 'semantic' }
}

/** Pages that are clearly the source: the best hit's page + any page with ≥ 2 hits in the top 8 (max 2 pages). */
function pagesToExpand(hits: any[]) {
  const top = hits.slice(0, 8)
  const count: Record<string, number> = {}
  for (const h of top) count[h.page_id] = (count[h.page_id] || 0) + 1
  const ids: string[] = []
  if (hits[0]) ids.push(hits[0].page_id)
  for (const h of top) if (count[h.page_id] >= 2 && !ids.includes(h.page_id)) ids.push(h.page_id)
  return ids.slice(0, 2)
}

export async function answerQuestion(sb: any, client: any, content: string, history: Msg[]) {
  const searchQuery = await rewriteQuery(client, history, content)
  const { hits, mode } = await search(sb, client.id, searchQuery, searchQuery === content ? '' : content)
  const best = hits.reduce((m, h) => Math.max(m, Number(h.similarity) || 0), 0)
  const threshold = Number(client.confidence_threshold ?? 0.35)
  // keyword matches count as evidence too: an exact term ("parcheggio", a product name) with a fair similarity is a hit
  const confident = best >= threshold || hits.some((h) => (h.keyword_rank || 0) > 0 && (h.similarity || 0) >= threshold * 0.7)

  // ---- context: expanded pages first, then the other relevant fragments
  const expandIds = pagesToExpand(hits)
  const expanded: any[] = []
  const used = new Set<string>()
  if (expandIds.length) {
    const { data: rows } = await sb.from('wa_chunks').select('id,page_id,idx,content,url,anchor,title,heading_path').in('page_id', expandIds).order('idx')
    for (const pid of expandIds) {
      const chunks = (rows || []).filter((r: any) => r.page_id === pid)
      if (!chunks.length) continue
      const hitIdx = hits.filter((h) => h.page_id === pid).map((h) => h.idx ?? 0)
      const start = Math.max(0, Math.min(...hitIdx) - 1)
      let text = ''
      let lastSection = ''
      const ids: string[] = []
      for (const c of [...chunks.slice(start), ...chunks.slice(0, start)]) { // from just before the first hit, then the rest
        const section = c.heading_path && c.heading_path !== lastSection ? `[${c.heading_path}]
` : ''
        lastSection = c.heading_path || lastSection
        const piece = section + stripHeader(c.content)
        if (text.length + piece.length > PAGE_CHARS) { if (hitIdx.includes(c.idx)) { text += `\n\n${piece}`; ids.push(c.id) } continue }
        text += (text ? '\n\n' : '') + piece; ids.push(c.id)
      }
      const firstHit = hits.find((h) => h.page_id === pid)
      expanded.push({ page_id: pid, title: chunks[0].title, url: linkOf({ url: chunks[0].url, anchor: firstHit?.anchor }), text, chunk_ids: ids })
      ids.forEach((i) => used.add(i))
    }
  }
  const blocks: string[] = []
  let n = 0
  for (const p of expanded) blocks.push(`### Fonte ${++n}: ${p.title || 'Pagina'}\n${p.url ? `URL: ${p.url}\n` : ''}\n${p.text}`)
  for (const h of hits) {
    if (used.has(h.id) || expandIds.includes(h.page_id)) continue
    if (blocks.join('\n\n').length > CONTEXT_CHARS) break
    const link = linkOf(h)
    blocks.push(`### Fonte ${++n}: ${h.title || (h.kind === 'document' ? 'Documento' : 'Pagina')}${h.heading_path ? ` > ${h.heading_path}` : ''}\n${link ? `URL: ${link}\n` : ''}\n${stripHeader(h.content)}`)
    used.add(h.id)
  }
  const ctx = blocks.join('\n\n---\n\n').slice(0, CONTEXT_CHARS + 4000)

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

  const result = await llm(client.model, [{ role: 'system', content: system }, ...history, { role: 'user', content }], { temperature: Number(client.temperature ?? 0.2), max_tokens: 1200 })
  const answer = result.text.trim() || 'Mi dispiace, non riesco a rispondere in questo momento.'

  const retrieval = {
    version: 2, mode, question: content, search_query: searchQuery, threshold, best_similarity: Number(best.toFixed(3)), confident,
    expanded_pages: expanded.map((p) => ({ page_id: p.page_id, title: p.title, url: p.url, chars: p.text.length })),
    context_chars: ctx.length,
    hits: hits.map((h) => ({
      chunk_id: h.id, page_id: h.page_id, url: h.url, anchor: h.anchor, title: h.title, heading_path: h.heading_path, kind: h.kind,
      similarity: Number(Number(h.similarity || 0).toFixed(3)), keyword: Number(Number(h.keyword_rank || 0).toFixed(3)), score: Number(Number(h.score || 0).toFixed(4)),
      used: used.has(h.id) || expandIds.includes(h.page_id), preview: stripHeader(h.content).slice(0, 400),
    })),
  }
  const sources = hits.slice(0, 5).map((h) => ({ url: h.url, anchor: h.anchor, title: h.title, heading_path: h.heading_path, score: Number(Number(h.similarity || 0).toFixed(3)) }))
  return { answer, result, confident, retrieval, sources }
}
