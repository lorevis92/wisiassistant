// deno-lint-ignore-file no-explicit-any
import { embed, sendEmail, Timer } from './common.ts'
import { deliverToChannel } from './channels.ts'
import { handoffEnabled } from './policy.ts'
import { answerQuestion } from './answer.ts'

export type RunOpts = {
  /** request timer started when the request arrived (chat function), for the per-answer timings */
  timer?: Timer
  /** streaming: 'meta' (conversation id, as soon as known), 'delta' (answer text), 'done' (final message) */
  onEvent?: (event: string, data: unknown) => void
}

/**
 * Core pipeline: used by the widget/standalone (streamed) and by channel webhooks.
 * Everything that does not depend on something else runs in parallel: the question's embedding starts at once,
 * alongside rate limit and conversation lookup; the user message is stored while the history is read.
 * The reply is announced ('done', with a pre-generated id) before it is written, so the visitor never waits on it.
 */
export async function runMessage(sb: any, client: any, b: any, opts: RunOpts = {}) {
  const T = opts.timer || new Timer()
  const emit = opts.onEvent || (() => {})
  const content = String(b.content || '').trim().slice(0, 4000)
  if (!content) throw new Error('Messaggio vuoto')

  // embedding of the question right away: it does not depend on the database
  const embedding = T.time('embedding', embed([content]).then((v) => v[0]))
  embedding.catch(() => {}) // awaited later; avoids an unhandled rejection if the operator path returns first

  const setupStart = performance.now()
  // rate limit (per visitor/external id) + conversation lookup, in parallel
  const rlKey = `${client.id}:${b.external_id || b.visitor_id || b.conversation_id || 'anon'}`
  const findConv = async () => {
    if (b.conversation_id) {
      const { data } = await sb.from('wa_conversations').select('*').eq('id', b.conversation_id).eq('client_id', client.id).maybeSingle()
      if (data) return data
    }
    if (b.external_id) {
      const { data } = await sb.from('wa_conversations').select('*').eq('client_id', client.id).eq('channel', b.channel).eq('external_id', b.external_id).neq('status', 'resolved').order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) return data
    }
    return null
  }
  const [{ data: allowed }, found] = await Promise.all([
    sb.rpc('wa_check_rate_limit', { p_key: rlKey, p_limit: client.rate_limit_per_hour || 60 }),
    findConv(),
  ])
  if (allowed === false) throw Object.assign(new Error('Troppi messaggi, riprova tra poco'), { status: 429 })

  let conv: any = found
  const isNew = !conv
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
  emit('meta', { conversation_id: conv.id })

  // store the user message and read the history (last 10 turns) at the same time; a new conversation has none
  const [{ data: userMsg }, { data: hist }] = await Promise.all([
    sb.from('wa_messages').insert({ conversation_id: conv.id, role: 'user', content }).select('id').single(),
    isNew ? Promise.resolve({ data: [] }) : sb.from('wa_messages').select('id,role,content').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(11),
  ])
  T.add('setup', setupStart, performance.now())

  // operator has taken over → do not answer with the bot
  if (conv.status === 'human') {
    const r = { conversation_id: conv.id, role: 'assistant', content: 'Un operatore sta seguendo la conversazione e ti risponderà qui a breve.', message_id: null, handoff: true }
    emit('done', r)
    return r
  }

  const history = (hist || []).filter((m: any) => m.id !== userMsg?.id).slice(0, 10).reverse()
    .map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))

  // retrieval + answer (shared with the test questions): see answer.ts
  const { answer, result, confident, retrieval, sources, interrupted } = await answerQuestion(sb, client, content, history, {
    timer: T, embedding, onDelta: (t) => emit('delta', { text: t }),
  })
  const wantsHuman = /\b(operatore|persona|umano|human|parlare con qualcuno|agent|mitarbeiter|conseiller|someone real)\b/i.test(content)
  const handoff = handoffEnabled(client)
  // internal escalation (Inbox + email) only when "Passaggio a operatore" is enabled for the client
  const shouldEscalate = handoff && (wantsHuman || (!confident && conv.message_count >= 2)) && conv.status !== 'escalated'

  const botId = crypto.randomUUID()
  const reply = { conversation_id: conv.id, role: 'assistant', content: answer, message_id: botId, no_answer: !confident, escalated: shouldEscalate, interrupted: !!interrupted }
  emit('done', reply)

  // ---- writes after the visitor has the answer
  const row = { id: botId, conversation_id: conv.id, role: 'assistant', content: answer, sources, retrieval, model: client.model, tokens_in: result.tokens_in, tokens_out: result.tokens_out }
  const saves: Promise<unknown>[] = [
    (async () => {
      const { error: insErr } = await sb.from('wa_messages').insert(row)
      if (insErr && /retrieval/.test(insErr.message)) { // migration 0009 not run yet
        const { retrieval: _r, ...legacy } = row
        await sb.from('wa_messages').insert(legacy)
      } else if (insErr) console.error('bot message insert', insErr.message)
    })(),
  ]
  // no-answer tracking + escalation
  if (!confident && userMsg?.id) saves.push(sb.from('wa_messages').update({ no_answer: true }).eq('id', userMsg.id))
  if (shouldEscalate) {
    const reason = wantsHuman ? 'Richiesta esplicita di un operatore' : 'Il bot non ha trovato risposte nella knowledge base'
    saves.push(sb.from('wa_conversations').update({ status: 'escalated', escalation_reason: reason }).eq('id', conv.id))
    notifyEscalation(sb, client, conv, reason).catch((e) => console.error('escalation mail', e))
  }
  // deliver to external channel (telegram/whatsapp) — widget/standalone receive it via response
  if (!['web', 'standalone'].includes(conv.channel)) saves.push(deliverToChannel(client, conv, answer))
  await Promise.all(saves)

  return reply
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
