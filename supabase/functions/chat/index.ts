// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, getUser, isServiceRole } from '../_shared/common.ts'
import { deliverToChannel } from '../_shared/channels.ts'
import { runMessage } from '../_shared/rag.ts'

/**
 * Modes (POST JSON):
 *  - config      { client_slug, channel, origin }                        → public widget config (domain-locked)
 *  - message     { client_slug, conversation_id?, content, channel, page_url, origin, lead?, external_id?, visitor_id? }
 *  - poll        { conversation_id, after }                                → messages after index (operator replies)
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
      case 'poll': return await modePoll(sb, body)
      case 'feedback': return await modeFeedback(sb, body)
      case 'human_reply': {
        const user = await getUser(req)
        if (!user && !isServiceRole(req)) return err('Non autorizzato', 401)
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
  const { data } = await sb.from('clients').select('*').eq('slug', slug).maybeSingle()
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

async function modePoll(sb: any, b: any) {
  // Returns bot/operator messages created after the last message the client already has (by id).
  if (!b.conversation_id) return json({ messages: [] })
  let since: string | null = null
  if (b.after_id) {
    const { data: last } = await sb.from('messages').select('created_at').eq('id', b.after_id).maybeSingle()
    since = last?.created_at || null
  }
  let q = sb.from('messages').select('id,role,content,created_at').eq('conversation_id', b.conversation_id).neq('role', 'user').order('created_at')
  if (since) q = q.gt('created_at', since)
  const { data } = await q
  const { data: conv } = await sb.from('conversations').select('status').eq('id', b.conversation_id).maybeSingle()
  return json({ messages: data || [], status: conv?.status })
}

async function modeFeedback(sb: any, b: any) {
  await sb.from('messages').update({ feedback: b.value === 1 ? 1 : -1 }).eq('id', b.message_id)
  return json({ ok: true })
}

async function modeHumanReply(sb: any, b: any) {
  const { data: conv } = await sb.from('conversations').select('*, client:clients(*)').eq('id', b.conversation_id).single()
  if (!conv) return err('Conversazione non trovata', 404)
  const { data: m } = await sb.from('messages').insert({ conversation_id: conv.id, role: 'human', content: b.content }).select().single()
  if (conv.status !== 'human') await sb.from('conversations').update({ status: 'human' }).eq('id', conv.id)
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
