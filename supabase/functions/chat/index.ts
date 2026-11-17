// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, requireAdmin } from '../_shared/common.ts'
import { deliverToChannel } from '../_shared/channels.ts'
import { runMessage } from '../_shared/rag.ts'

/**
 * Modes (POST JSON):
 *  - config      { client_slug, channel, origin }                        → public widget config (optional domain lock, see originAllowed)
 *  - message     { client_slug, conversation_id?, content, channel, page_url, origin, lead?, external_id?, visitor_id? }
 *  - history     { client_slug, conversation_id }                         → full transcript (user, assistant, operator) for a saved conversation
 *  - poll        { conversation_id, after_id, client_slug? }               → operator (human) replies after the cursor only;
 *                                                                            without a cursor returns no messages, just `cursor` (latest id)
 *  - feedback    { message_id, value }                                     → 👍/👎
 *  - end         { client_slug, conversation_id }                         → visitor ended the chat ("Termina chat"): open → resolved
 *  - human_reply { conversation_id, content }  (admin only)               → operator reply, delivered to channel
 *
 * The RAG pipeline lives in _shared/rag.ts (runMessage) and is reused by the channel webhooks.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: any
  try { body = await req.json() } catch { return err('JSON non valido') }
  const sb = admin()

  try {
    switch (body.mode) {
      case 'config': return await modeConfig(sb, body)
      case 'message': return await modeMessage(sb, body)
      case 'history': return await modeHistory(sb, body)
      case 'poll': return await modePoll(sb, body)
      case 'feedback': return await modeFeedback(sb, body)
      case 'end': return await modeEnd(sb, body)
      case 'human_reply': {
        const denied = await requireAdmin(req)
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
async function loadClient(sb: any, slug: string) {
  if (!slug) throw Object.assign(new Error('client_slug mancante'), { status: 400 })
  const { data, error } = await sb.from('wa_clients').select('*').eq('slug', slug).maybeSingle()
  if (error) throw new Error(`Database: ${error.message}`)
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
    const { data: c } = await sb.from('wa_clients').select('id').eq('slug', b.client_slug).maybeSingle()
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
async function modeMessage(sb: any, b: any) {
  const client = await loadClient(sb, b.client_slug)
  if (!originAllowed(client, b.channel || 'web', b.origin)) return err(`Dominio non autorizzato: ${hostOf(b.origin) || '(sconosciuto)'}`, 403)
  const r = await runMessage(sb, client, b)
  return json(r)
}
