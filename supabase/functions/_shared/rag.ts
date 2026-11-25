// deno-lint-ignore-file no-explicit-any
import { sendEmail } from './common.ts'
import { deliverToChannel } from './channels.ts'
import { handoffEnabled } from './policy.ts'
import { answerQuestion } from './answer.ts'

/** Core pipeline: used by the widget/standalone and by channel webhooks. */
export async function runMessage(sb: any, client: any, b: any) {
  const content = String(b.content || '').trim().slice(0, 4000)
  if (!content) throw new Error('Messaggio vuoto')

  // rate limit (per visitor/external id)
  const rlKey = `${client.id}:${b.external_id || b.visitor_id || b.conversation_id || 'anon'}`
  const { data: allowed } = await sb.rpc('wa_check_rate_limit', { p_key: rlKey, p_limit: client.rate_limit_per_hour || 60 })
  if (allowed === false) throw new Error('Troppi messaggi, riprova tra poco')

  // conversation
  let conv: any = null
  if (b.conversation_id) {
    const { data } = await sb.from('wa_conversations').select('*').eq('id', b.conversation_id).eq('client_id', client.id).maybeSingle(); conv = data
  }
  if (!conv && b.external_id) {
    const { data } = await sb.from('wa_conversations').select('*').eq('client_id', client.id).eq('channel', b.channel).eq('external_id', b.external_id).neq('status', 'resolved').order('created_at', { ascending: false }).limit(1).maybeSingle(); conv = data
  }
  if (!conv) {
    const { data } = await sb.from('wa_conversations').insert({
      client_id: client.id, channel: b.channel || 'web', external_id: b.external_id || null, visitor_id: b.visitor_id || null,
      visitor_label: b.visitor_label || null, page_url: b.page_url || null,
      lead_name: b.lead?.name || null, lead_email: b.lead?.email || null, lead_phone: b.lead?.phone || null,
    }).select().single()
    conv = data
    if (b.lead?.email || b.lead?.phone) await sb.from('wa_leads').insert({ client_id: client.id, conversation_id: conv.id, name: b.lead.name, email: b.lead.email, phone: b.lead.phone, channel: b.channel || 'web' })
  } else if (b.lead?.email && !conv.lead_email) {
    await sb.from('wa_conversations').update({ lead_name: b.lead.name, lead_email: b.lead.email, lead_phone: b.lead.phone || null }).eq('id', conv.id)
    await sb.from('wa_leads').insert({ client_id: client.id, conversation_id: conv.id, name: b.lead.name, email: b.lead.email, phone: b.lead.phone, channel: conv.channel })
  }

  // store user message
  const { data: userMsg } = await sb.from('wa_messages').insert({ conversation_id: conv.id, role: 'user', content }).select().single()

  // operator has taken over → do not answer with the bot
  if (conv.status === 'human') {
    return { conversation_id: conv.id, role: 'assistant', content: 'Un operatore sta seguendo la conversazione e ti risponderà qui a breve.', message_id: null, handoff: true }
  }

  // history (last 10 turns)
  const { data: hist } = await sb.from('wa_messages').select('role,content').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(11)
  const history = (hist || []).reverse().slice(0, -1).map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))

  // retrieval + answer (shared with the test questions): see answer.ts
  const { answer, result, confident, retrieval, sources } = await answerQuestion(sb, client, content, history)
  const wantsHuman = /\b(operatore|persona|umano|human|parlare con qualcuno|agent|mitarbeiter|conseiller|someone real)\b/i.test(content)

  const handoff = handoffEnabled(client)
  const row = { conversation_id: conv.id, role: 'assistant', content: answer, sources, retrieval, model: client.model, tokens_in: result.tokens_in, tokens_out: result.tokens_out }
  let { data: botMsg, error: insErr } = await sb.from('wa_messages').insert(row).select().single()
  if (insErr && /retrieval/.test(insErr.message)) { // migration 0009 not run yet
    const { retrieval: _r, ...legacy } = row
    ;({ data: botMsg } = await sb.from('wa_messages').insert(legacy).select().single())
  }

  // no-answer tracking + escalation
  if (!confident) await sb.from('wa_messages').update({ no_answer: true }).eq('id', userMsg.id)
  // internal escalation (Inbox + email) only when "Passaggio a operatore" is enabled for the client
  const shouldEscalate = handoff && (wantsHuman || (!confident && conv.message_count >= 2)) && conv.status !== 'escalated'
  if (shouldEscalate) {
    const reason = wantsHuman ? 'Richiesta esplicita di un operatore' : 'Il bot non ha trovato risposte nella knowledge base'
    await sb.from('wa_conversations').update({ status: 'escalated', escalation_reason: reason }).eq('id', conv.id)
    notifyEscalation(sb, client, conv, reason).catch((e) => console.error('escalation mail', e))
  }

  // deliver to external channel (telegram/whatsapp) — widget/standalone receive it via response
  if (!['web', 'standalone'].includes(conv.channel)) await deliverToChannel(client, conv, answer)

  return { conversation_id: conv.id, role: 'assistant', content: answer, message_id: botMsg?.id, no_answer: !confident, escalated: shouldEscalate }
}

async function notifyEscalation(sb: any, client: any, conv: any, reason: string) {
  if (!client.escalation_email) return
  const { data: msgs } = await sb.from('wa_messages').select('role,content,created_at').eq('conversation_id', conv.id).order('created_at')
  const app = Deno.env.get('PUBLIC_APP_URL') || ''
  const thread = (msgs || []).map((m: any) => `<p><b>${m.role === 'user' ? 'Utente' : m.role === 'human' ? 'Operatore' : 'Bot'}</b> <span style="color:#999;font-size:11px">${new Date(m.created_at).toLocaleString('it-CH')}</span><br>${String(m.content).replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#10232F"><div style="color:#0F5A7F;font-weight:700;font-size:16px;margin-bottom:6px">Sardesk</div><h2 style="font-weight:600;font-size:20px;margin:0 0 10px">Richiesta di intervento umano — ${client.name}</h2>
    <p><b>Motivo:</b> ${reason}<br><b>Canale:</b> ${conv.channel}${conv.lead_name ? `<br><b>Nome:</b> ${conv.lead_name}` : ''}${conv.lead_email ? `<br><b>Email:</b> ${conv.lead_email}` : ''}${conv.page_url ? `<br><b>Pagina:</b> ${conv.page_url}` : ''}</p>
    ${app ? `<p><a href="${app}/clients/${client.id}/inbox" style="background:#0F5A7F;color:#fff;padding:9px 16px;border-radius:10px;text-decoration:none;font-weight:600">Apri in Inbox</a></p>` : ''}
    <hr style="border:0;border-top:1px solid #E0E3DC">${thread}</div>`
  await sendEmail([client.escalation_email], `[${client.name}] Richiesta di intervento umano`, html)
}
