// deno-lint-ignore-file no-explicit-any
import { admin, json } from '../_shared/common.ts'
import { runMessage } from '../_shared/rag.ts'

/**
 * Meta webhook (WhatsApp Cloud API, Messenger, Instagram share the same shape).
 * In Meta App → Webhooks, set callback URL to:
 *   https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook?client=<SLUG>
 * and verify token = META_VERIFY_TOKEN (secret). Subscribe to `messages` (WhatsApp), `messages` (Messenger/Instagram).
 * Deploy with: supabase functions deploy whatsapp-webhook --no-verify-jwt
 */
Deno.serve(async (req) => {
  const url = new URL(req.url)
  const slug = url.searchParams.get('client')

  // Verification handshake
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === (Deno.env.get('META_VERIFY_TOKEN') || 'wisi-assistant')) return new Response(challenge || '', { status: 200 })
    return new Response('forbidden', { status: 403 })
  }

  if (!slug) return json({ error: 'client mancante' }, 400)
  let body: any
  try { body = await req.json() } catch { return json({ ok: true }) }

  const sb = admin()
  const { data: client } = await sb.from('clients').select('*').eq('slug', slug).maybeSingle()
  if (!client) return json({ ok: true })

  const inbound: { channel: 'whatsapp' | 'messenger' | 'instagram'; from: string; text: string; label?: string }[] = []

  if (body.object === 'whatsapp_business_account') {
    for (const e of body.entry || []) for (const ch of e.changes || []) {
      const v = ch.value || {}
      const names: Record<string, string> = {}
      for (const c of v.contacts || []) names[c.wa_id] = c.profile?.name
      for (const m of v.messages || []) if (m.type === 'text') inbound.push({ channel: 'whatsapp', from: m.from, text: m.text.body, label: names[m.from] })
    }
  } else if (body.object === 'page' || body.object === 'instagram') {
    const channel = body.object === 'page' ? 'messenger' : 'instagram'
    for (const e of body.entry || []) for (const m of e.messaging || []) {
      if (m.message?.text && !m.message.is_echo) inbound.push({ channel, from: m.sender.id, text: m.message.text })
    }
  }

  for (const im of inbound) {
    if (!(client.channels || []).includes(im.channel)) continue
    try { await runMessage(sb, client, { content: im.text, channel: im.channel, external_id: im.from, visitor_label: im.label || `${im.channel}-${im.from}` }) }
    catch (e) { console.error(e) }
  }
  return json({ ok: true })
})
