// deno-lint-ignore-file no-explicit-any
import { embed, llm, sendEmail } from './common.ts'
import { deliverToChannel } from './channels.ts'

const LANG_NAME: Record<string, string> = { it: 'italiano', de: 'tedesco', fr: 'francese', en: 'inglese' }

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

  // retrieval: embed a query that includes the last user turn for context
  const lastUser = history.filter((h: any) => h.role === 'user').slice(-1)[0]?.content
  const query = lastUser && content.length < 60 ? `${lastUser}\n${content}` : content
  const [qvec] = await embed([query])
  const { data: hits } = await sb.rpc('wa_match_chunks', { p_client_id: client.id, p_embedding: qvec, p_match_count: 8, p_min_similarity: 0 })
  const top = (hits || []) as any[]
  const best = top[0]?.similarity ?? 0
  const threshold = Number(client.confidence_threshold ?? 0.35)
  const confident = best >= threshold
  const wantsHuman = /\b(operatore|persona|umano|human|parlare con qualcuno|agent|mitarbeiter|conseiller|someone real)\b/i.test(content)

  // build context with URL + section so the model can link naturally
  const ctx = top.filter((h) => h.similarity >= Math.min(threshold, 0.2)).map((h, i) => {
    const link = h.url.startsWith('wisi://') ? (h.title ? `(documento: ${h.title})` : '') : `${h.url}${h.anchor ? `#${h.anchor}` : ''}`
    return `[${i + 1}] ${h.heading_path ? `Sezione: ${h.heading_path}\n` : ''}${link ? `Link: ${link}\n` : ''}${h.content}`
  }).join('\n\n---\n\n')

  const langRule = client.language && client.language !== 'auto' ? `Rispondi sempre in ${LANG_NAME[client.language] || client.language}.` : 'Rispondi nella stessa lingua in cui scrive l’utente.'
  const system = [
    client.instructions || `Sei l'assistente virtuale di ${client.name}. Rispondi in modo cortese e conciso usando solo le informazioni nel contesto.`,
    langRule,
    `Hai a disposizione dei frammenti di contesto numerati. Ogni frammento ha un "Link" (URL della pagina, con #sezione quando disponibile): quando è utile per l'utente, inserisci il link direttamente nella risposta in formato markdown [testo](url), senza chiamarlo "fonte" e senza elencare le fonti alla fine. Non inventare link.`,
    confident ? '' : `ATTENZIONE: il contesto non contiene informazioni sufficienti per questa domanda. Dillo chiaramente in una frase, non inventare nulla, e proponi di mettere l'utente in contatto con una persona (chiedi se vuole essere ricontattato).`,
    `Formattazione: testo semplice, al massimo grassetto **così**; niente tabelle, niente titoli.`,
    `\n=== CONTESTO ===\n${ctx || '(nessun contenuto rilevante trovato)'}\n=== FINE CONTESTO ===`,
  ].filter(Boolean).join('\n\n')

  const result = await llm(client.model, [{ role: 'system', content: system }, ...history, { role: 'user', content }], { temperature: Number(client.temperature ?? 0.2), max_tokens: 900 })
  const answer = result.text.trim() || 'Mi dispiace, non riesco a rispondere in questo momento.'

  const sources = top.slice(0, 5).map((h) => ({ url: h.url, anchor: h.anchor, title: h.title, heading_path: h.heading_path, score: Number(h.similarity.toFixed(3)) }))
  const { data: botMsg } = await sb.from('wa_messages').insert({ conversation_id: conv.id, role: 'assistant', content: answer, sources, model: client.model, tokens_in: result.tokens_in, tokens_out: result.tokens_out }).select().single()

  // no-answer tracking + escalation
  if (!confident) await sb.from('wa_messages').update({ no_answer: true }).eq('id', userMsg.id)
  const shouldEscalate = (wantsHuman || (!confident && conv.message_count >= 2)) && conv.status !== 'escalated'
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
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111"><h2 style="font-family:Georgia,serif;font-weight:400">Richiesta di intervento umano — ${client.name}</h2>
    <p><b>Motivo:</b> ${reason}<br><b>Canale:</b> ${conv.channel}${conv.lead_name ? `<br><b>Nome:</b> ${conv.lead_name}` : ''}${conv.lead_email ? `<br><b>Email:</b> ${conv.lead_email}` : ''}${conv.page_url ? `<br><b>Pagina:</b> ${conv.page_url}` : ''}</p>
    ${app ? `<p><a href="${app}/clients/${client.id}/inbox" style="background:#E8352A;color:#fff;padding:8px 14px;border-radius:3px;text-decoration:none;font-weight:700">Apri in Inbox</a></p>` : ''}
    <hr style="border:0;border-top:1px solid #E8E8E8">${thread}</div>`
  await sendEmail([client.escalation_email], `[${client.name}] Richiesta di intervento umano`, html)
}
