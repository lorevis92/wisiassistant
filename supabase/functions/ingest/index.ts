// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, getUser, isServiceRole, embed, chunkMarkdown } from '../_shared/common.ts'

/**
 * Ingests manual knowledge (admin only):
 *  { client_id, kind: 'faq'|'text', title, content, link? }
 *  { client_id, kind: 'document', storage_path, title }   → reads from the `documents` bucket (PDF/DOCX/TXT/MD)
 * Creates a `pages` row (url = wisi://doc/<uuid>), chunks + embeds into `chunks`.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const user = await getUser(req)
  if (!user && !isServiceRole(req)) return err('Non autorizzato', 401)
  let b: any
  try { b = await req.json() } catch { return err('JSON non valido') }
  const sb = admin()

  const pageId = crypto.randomUUID()
  const url = b.link && b.kind !== 'document' ? b.link : `wisi://doc/${pageId}`
  const { data: page, error: pe } = await sb.from('pages').insert({
    id: pageId, client_id: b.client_id, url, title: b.title || 'Documento', kind: b.kind, status: 'pending', storage_path: b.storage_path || null, link: b.link || null,
  }).select().single()
  if (pe) return err(pe.message)

  try {
    let text = ''
    if (b.kind === 'document') text = await extractDocument(sb, b.storage_path, b.title)
    else text = String(b.content || '')
    if (!text.trim()) throw new Error('Nessun testo estratto')

    const md = b.kind === 'faq' ? `# ${b.title}\n\n${text}` : text.includes('\n#') || text.startsWith('#') ? text : `# ${b.title}\n\n${text}`
    const parts = chunkMarkdown(md, { maxChars: 1400 })
    const vecs = await embed(parts.map((p) => p.content))
    const rows = parts.map((p, i) => ({
      client_id: b.client_id, page_id: page.id, idx: i, content: p.content, url: page.url,
      anchor: null, heading_path: p.heading_path, title: b.title, embedding: vecs[i], token_count: Math.round(p.content.length / 4),
    }))
    for (let i = 0; i < rows.length; i += 50) { const { error } = await sb.from('chunks').insert(rows.slice(i, i + 50)); if (error) throw error }
    await sb.from('pages').update({ status: 'ok', chunk_count: rows.length, word_count: text.split(/\s+/).length, last_crawled_at: new Date().toISOString() }).eq('id', page.id)
    return json({ ok: true, page_id: page.id, chunks: rows.length })
  } catch (e) {
    await sb.from('pages').update({ status: 'failed', error: (e as Error).message }).eq('id', page.id)
    return err((e as Error).message, 500)
  }
})

async function extractDocument(sb: any, path: string, name: string) {
  const { data, error } = await sb.storage.from('documents').download(path)
  if (error) throw error
  const lower = (name || path).toLowerCase()
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return await data.text()
  if (lower.endsWith('.pdf')) {
    // Lightweight PDF text extraction via unpdf (pdf.js build for serverless)
    const { extractText, getDocumentProxy } = await import('npm:unpdf@0.12.1')
    const buf = new Uint8Array(await data.arrayBuffer())
    const pdf = await getDocumentProxy(buf)
    const { text } = await extractText(pdf, { mergePages: true })
    return text
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('npm:mammoth@1.8.0')
    const buf = await data.arrayBuffer()
    const r = await mammoth.convertToHtml({ arrayBuffer: buf })
    // minimal HTML → markdown so headings become sections
    return r.value
      .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_: string, l: string, t: string) => `\n${'#'.repeat(Number(l))} ${t.replace(/<[^>]+>/g, '')}\n`)
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<\/p>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  }
  throw new Error('Formato non supportato (usa PDF, DOCX, TXT o MD)')
}
