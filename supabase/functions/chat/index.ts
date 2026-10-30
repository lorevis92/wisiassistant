// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, requireAdmin } from '../_shared/common.ts'
import { deliverToChannel } from '../_shared/channels.ts'
import { runMessage } from '../_shared/rag.ts'

/**
 * Modes (POST JSON):
 *  - config      { client_slug, channel, origin }                        → public widget config (domain-locked)
 *  - message     { client_slug, conversation_id?, content, channel, page_url, origin, lead?, external_id?, visitor_id? }
 *  - history     { client_slug, conversation_id }                         → full transcript (user, assistant, operator) for a saved conversation
 *  - poll        { conversation_id, after_id, client_slug? }               → operator (human) replies after the cursor only;
 *                                                                            without a cursor returns no messages, just `cursor` (latest id)
 *  - feedback    { message_id, value }                                     → 👍/👎
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
      case 'human_reply': {
        const denied = await requireAdmin(req)
        if (denied) return denied
        return await modeHumanReply(sb, body)
      }
      default: return err('mode sconosciuto')
    }
  } catch (e) {
    console.error(e)
    return err((e as Error).message || 'Errore interno', 500)
  }
})

// ------------------------------------------------------------------ helpers
async function loadClient(sb: any, slug: string) {
  const { data } = await sb.from('wa_clients').select('*').eq('slug', slug).maybeSingle()
  if (!data) throw new Error('Cliente non trovato')
  if (data.status === 'paused') throw new Error('Assistente in pausa')
  return data
}

function originAllowed(client: any, channel: string, origin?: string) {
  if (channel !== 'web') return true
  if (!origin) return false
  const o = String(origin).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
  if (o === 'localhost' || o === '127.0.0.1') return true
  const allowed: string[] = (client.allowed_domains || []).map((d: string) => d.toLowerCase())
  if (client.domain) { try { allowed.push(new URL(client.domain).hostname.toLowerCase()) } catch { /* ignore */ } }
  return allowed.some((d) => o === d || o.endsWith(`.${d}`) || o === `www.${d}` || d === `www.${o}`)
}

async function modeConfig(sb: any, b: any) {
  const c = await loadClient(sb, b.client_slug)
  if (!originAllowed(c, b.channel || 'web', b.origin)) return err('Dominio non autorizzato', 403)
  return json({ name: c.name, widget: c.widget || {}, language: c.language })
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
  if (!originAllowed(client, b.channel || 'web', b.origin)) return err('Dominio non autorizzato', 403)
  const r = await runMessage(sb, client, b)
  return json(r)
}
