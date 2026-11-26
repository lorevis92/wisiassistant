// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, requireClientAccess, Timer } from '../_shared/common.ts'
import { answerQuestion } from '../_shared/answer.ts'
import { deliverToChannel } from '../_shared/channels.ts'
import { runMessage } from '../_shared/rag.ts'

/**
 * Modes (POST JSON):
 *  - config      { client_slug, channel, origin }                        → public widget config (optional domain lock, see originAllowed)
 *  - message     { client_slug, conversation_id?, content, channel, page_url, origin, lead?, external_id?, visitor_id?, stream? }
 *                 stream: true → text/event-stream: `meta` {conversation_id}, `delta` {text}…, `done` {message_id, content…}
 *                 or `error` {error}. Without stream (old widgets): one JSON reply.
 *  - history     { client_slug, conversation_id }                         → full transcript (user, assistant, operator) for a saved conversation
 *  - poll        { conversation_id, after_id, client_slug? }               → operator (human) replies after the cursor only;
 *                                                                            without a cursor returns no messages, just `cursor` (latest id)
 *  - feedback    { message_id, value }                                     → 👍/👎
 *  - end         { client_slug, conversation_id }                         → visitor ended the chat ("Termina chat"): open → resolved
 *  - test        { client_id, question }        (members with access to the client) → answer + retrieval, nothing stored
 *  - human_reply { conversation_id, content }  (members with access to the conversation's client)               → operator reply, delivered to channel
 *
 * The RAG pipeline lives in _shared/rag.ts (runMessage) and is reused by the channel webhooks.
 */

// Function start: performance.now() counts from the isolate start, so on the first request of an isolate (cold start)
// it is the time spent booting the runtime and loading this code.
let served = 0

Deno.serve(async (req) => {
  const t0 = performance.now()
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const T = new Timer(t0)
  const cold = served++ === 0
  T.info.cold = cold
  if (cold) T.info.boot_ms = Math.round(t0)
  let body: any
  try { body = await T.time('request', req.json()) } catch { return err('JSON non valido') }
  const sb = admin()

  try {
    switch (body.mode) {
      case 'config': return await modeConfig(sb, body)
      case 'message': return await modeMessage(sb, body, T)
      case 'history': return await modeHistory(sb, body)
      case 'poll': return await modePoll(sb, body)
      case 'feedback': return await modeFeedback(sb, body)
      case 'end': return await modeEnd(sb, body)
      case 'test': {
        // test questions (client page → Prova): same retrieval + answer as the chat, nothing stored
        const denied = await requireClientAccess(req, body.client_id)
        if (denied) return denied
        const question = String(body.question || '').trim().slice(0, 1000)
        if (!question) return err('Domanda vuota')
        const { data: client } = await T.time('setup', sb.from('wa_clients').select('*').eq('id', body.client_id).single())
        if (!client) return err('Cliente non trovato', 404)
        const r = await answerQuestion(sb, client, question, [], { timer: T })
        return json({ answer: r.answer, confident: r.confident, retrieval: r.retrieval, timings: r.retrieval.timings, model: client.model })
      }
      case 'human_reply': {
        const { data: c } = await sb.from('wa_conversations').select('client_id').eq('id', body.conversation_id).maybeSingle()
        if (!c) return err('Conversazione non trovata', 404)
        const denied = await requireClientAccess(req, c.client_id)
        if (denied) return denied
        return await modeHumanReply(sb, body)
      }
      default: return err('mode sconosciuto')
    }
  } catch (e) {
    console.error(e)
    return err((e as Error).message || 'Errore interno', (e as any).status || 500)
  }
})

// ------------------------------------------------------------------ helpers
// Client configuration cache (per isolate): config, every message and poll read the same row. Changes made in the
// panel (model, instructions, pause…) apply within CLIENT_TTL_MS.
const CLIENT_TTL_MS = 30_000
const clientCache = new Map<string, { at: number; data: any }>()

/** Client row by slug, from the cache when fresh (null if unknown). */
async function getClient(sb: any, slug: string) {
  const hit = clientCache.get(slug)
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.data
  const r = await sb.from('wa_clients').select('*').eq('slug', slug).maybeSingle()
  if (r.error) throw new Error(`Database: ${r.error.message}`)
  if (r.data) {
    clientCache.set(slug, { at: Date.now(), data: r.data })
    if (clientCache.size > 500) clientCache.delete(clientCache.keys().next().value!)
  }
  return r.data
}

async function loadClient(sb: any, slug: string) {
  if (!slug) throw Object.assign(new Error('client_slug mancante'), { status: 400 })
  const data = await getClient(sb, slug)
  if (!data) throw Object.assign(new Error('Cliente non trovato'), { status: 404 })
  if (data.status === 'paused') throw Object.assign(new Error('Assistente in pausa'), { status: 403 })
  return data
}

/** Bare lowercase hostname from "https://www.site.it/path", "www.site.it", "site.it:8080"… ('' if unusable). */
function hostOf(v: unknown) {
  return String(v || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
}

/**
 * Optional domain lock for the site widget (channel 'web').
 *  - no allowed_domains for the client → the widget works on any site (the main site alone is NOT a restriction);
 *  - allowed_domains set → only those domains (and their subdomains; www / non-www are equivalent);
 *  - always allowed, for tests: localhost (any port), 127.0.0.1, [::1], *.localhost and pages opened from file://
 *    (origin "null" or empty).
 * Other channels are never checked here: the standalone page uses channel 'standalone', Telegram / WhatsApp go
 * through their webhooks straight to runMessage.
 */
function originAllowed(client: any, channel: string, origin?: string) {
  if (channel !== 'web') return true
  const allowed = (Array.isArray(client.allowed_domains) ? client.allowed_domains : []).map(hostOf).filter(Boolean)
  if (!allowed.length) return true
  const raw = String(origin ?? '').trim().toLowerCase()
  if (!raw || raw === 'null' || raw.startsWith('file:')) return true
  const o = hostOf(raw)
  if (!o) return true
  if (o === 'localhost' || o.endsWith('.localhost') || o === '127.0.0.1' || o === '[::1]' || o === '::1') return true
  const bare = (h: string) => h.replace(/^www\./, '')
  return allowed.some((d) => o === d || o.endsWith(`.${d}`) || bare(o) === bare(d))
}

/**
 * Public widget config. `widget` is clients.widget as saved by the admin (Impostazioni → Aspetto), read by
 * widget/chat-ui.js: title, welcome, suggestions, color, position, teaser_text, teaser_delay, disclaimer, lead_capture,
 * avatar (launcher, chat closed), header_avatar (header + bot messages, chat open; null → launcher image), bot_avatar.
 * Unknown / unsafe values are sanitized client-side (widget/avatars.js), so new fields need no change here.
 */
async function modeConfig(sb: any, b: any) {
  const c = await loadClient(sb, b.client_slug)
  if (!originAllowed(c, b.channel || 'web', b.origin)) return err(`Dominio non autorizzato: ${hostOf(b.origin) || '(sconosciuto)'}`, 403)
  const widget = c.widget && typeof c.widget === 'object' && !Array.isArray(c.widget) ? c.widget : {}
  return json({ name: c.name, widget, language: c.language })
}

/** Saved conversation (widget / standalone page), checked against the client when client_slug is given. */
async function loadConversation(sb: any, b: any) {
  if (!b.conversation_id) return null
  const { data: conv } = await sb.from('wa_conversations').select('id,client_id,status').eq('id', b.conversation_id).maybeSingle()
  if (!conv) return null
  if (b.client_slug) {
    const c = await getClient(sb, b.client_slug)
    if (c?.id !== conv.client_id) return null
  }
  return conv
}

async function modeHistory(sb: any, b: any) {
  // Full transcript, in order, so a reloaded widget / standalone page can show it and set its poll cursor.
  if (!b.client_slug) return err('client_slug mancante')
  const conv = await loadConversation(sb, b)
  if (!conv) return err('Conversazione non trovata', 404)
  const { data } = await sb.from('wa_messages').select('id,role,content,created_at,feedback').eq('conversation_id', conv.id).order('created_at')
  return json({ messages: data || [], status: conv.status })
}

async function modePoll(sb: any, b: any) {
  // Only operator (human) replies after the cursor: bot replies come back from `message`, older messages from `history`.
  const conv = await loadConversation(sb, b)
  if (!conv) return err('Conversazione non trovata', 404)
  let since: string | null = null
  if (b.after_id) {
    const { data: last } = await sb.from('wa_messages').select('created_at').eq('id', b.after_id).eq('conversation_id', conv.id).maybeSingle()
    since = last?.created_at || null
  }
  if (!since) {
    // no (valid) cursor: never send the whole history, just the latest message id to start from
    const { data: latest } = await sb.from('wa_messages').select('id').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    return json({ messages: [], cursor: latest?.id || null, status: conv.status })
  }
  const { data } = await sb.from('wa_messages').select('id,role,content,created_at').eq('conversation_id', conv.id).eq('role', 'human').gt('created_at', since).order('created_at')
  return json({ messages: data || [], status: conv.status })
}

async function modeEnd(sb: any, b: any) {
  // Only plain bot conversations are closed: escalated / operator ones stay open in the Inbox.
  const conv = await loadConversation(sb, b)
  if (!conv) return err('Conversazione non trovata', 404)
  if (conv.status === 'open') await sb.from('wa_conversations').update({ status: 'resolved' }).eq('id', conv.id)
  return json({ ok: true })
}

async function modeFeedback(sb: any, b: any) {
  await sb.from('wa_messages').update({ feedback: b.value === 1 ? 1 : -1 }).eq('id', b.message_id)
  return json({ ok: true })
}

async function modeHumanReply(sb: any, b: any) {
  const { data: conv } = await sb.from('wa_conversations').select('*, client:wa_clients(*)').eq('id', b.conversation_id).single()
  if (!conv) return err('Conversazione non trovata', 404)
  const { data: m } = await sb.from('wa_messages').insert({ conversation_id: conv.id, role: 'human', content: b.content }).select().single()
  if (conv.status !== 'human') await sb.from('wa_conversations').update({ status: 'human' }).eq('id', conv.id)
  await deliverToChannel(conv.client, conv, b.content)
  return json({ ok: true, message_id: m.id })
}

// ------------------------------------------------------------------ MESSAGE (RAG)
async function modeMessage(sb: any, b: any, T: Timer) {
  // errors found before answering (unknown client, paused, domain) stay plain JSON with their status code
  const client = await T.time('client', loadClient(sb, b.client_slug))
  if (!originAllowed(client, b.channel || 'web', b.origin)) return err(`Dominio non autorizzato: ${hostOf(b.origin) || '(sconosciuto)'}`, 403)
  if (!b.stream) return json(await runMessage(sb, client, b, { timer: T }))
  return sse((send) => runMessage(sb, client, b, { timer: T, onEvent: send }))
}

/**
 * Streamed reply (text/event-stream). If the visitor closes the chat mid-answer the stream is cancelled but the work
 * goes on (EdgeRuntime.waitUntil), so the answer is still stored and visible in the Inbox.
 */
function sse(run: (send: (event: string, data: unknown) => void) => Promise<unknown>) {
  const enc = new TextEncoder()
  let closed = false
  let ctrl: ReadableStreamDefaultController<Uint8Array>
  const send = (event: string, data: unknown) => {
    if (closed) return
    try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { closed = true }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
      ctrl.enqueue(enc.encode(': ok\n\n')) // headers out at once
      const work = run(send)
        .catch((e) => { console.error(e); send('error', { error: (e as Error).message || 'Errore interno', status: (e as any).status || 500 }) })
        .finally(() => { if (!closed) { closed = true; try { ctrl.close() } catch { /* already closed */ } } })
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(work)
    },
    cancel() { closed = true },
  })
  return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } })
}
