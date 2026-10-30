// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, getUser, isServiceRole, llm } from '../_shared/common.ts'
import { sendReport } from '../_shared/report.ts'

/**
 * Generates an AI report for a client and a period.
 *  - manual:    { client_id, period_start, period_end }  (admin)       → draft
 *  - scheduled: { mode: 'scheduled' } (called by pg_cron with service key) → for each client whose cadence is due today
 *               creates a draft, or sends immediately when report_auto_send = true.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const user = await getUser(req)
  if (!user && !isServiceRole(req)) return err('Non autorizzato', 401)
  let b: any
  try { b = await req.json() } catch { b = {} }
  const sb = admin()

  if (b.mode === 'scheduled') {
    const { data: clients } = await sb.from('clients').select('*').neq('report_frequency', 'none').neq('status', 'paused')
    const today = new Date()
    const results: any[] = []
    for (const c of clients || []) {
      const { due, start, end } = isDue(c, today)
      if (!due) continue
      try {
        const report = await buildReport(sb, c, start, end)
        if (c.report_auto_send && report.recipients.length) await sendReport(sb, report, c)
        await sb.from('clients').update({ last_report_at: new Date().toISOString() }).eq('id', c.id)
        results.push({ client: c.slug, report: report.id, sent: !!c.report_auto_send })
      } catch (e) { results.push({ client: c.slug, error: (e as Error).message }) }
    }
    return json({ ok: true, results })
  }

  const { data: client } = await sb.from('clients').select('*').eq('id', b.client_id).single()
  if (!client) return err('Cliente non trovato', 404)
  try {
    const report = await buildReport(sb, client, b.period_start, b.period_end)
    return json({ ok: true, report_id: report.id })
  } catch (e) { return err((e as Error).message, 500) }
})

function isDue(c: any, today: Date) {
  const dow = today.getUTCDay() // 1 = Monday
  const dom = today.getUTCDate()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minus = (n: number) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - n); return d }
  const last = c.last_report_at ? new Date(c.last_report_at) : null
  const daysSince = last ? (today.getTime() - last.getTime()) / 86400000 : 999
  if (c.report_frequency === 'weekly' && dow === 1 && daysSince > 5) return { due: true, start: iso(minus(7)), end: iso(minus(1)) }
  if (c.report_frequency === 'biweekly' && dow === 1 && daysSince > 12) return { due: true, start: iso(minus(14)), end: iso(minus(1)) }
  if (c.report_frequency === 'monthly' && dom === 1 && daysSince > 25) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
    return { due: true, start: iso(start), end: iso(minus(1)) }
  }
  return { due: false, start: '', end: '' }
}

async function buildReport(sb: any, c: any, start: string, end: string) {
  const from = `${start}T00:00:00Z`, to = `${end}T23:59:59Z`
  const { data: convs } = await sb.from('conversations').select('id,channel,status,escalation_reason,message_count,lead_email,created_at').eq('client_id', c.id).gte('created_at', from).lte('created_at', to)
  const ids = (convs || []).map((x: any) => x.id)
  let msgs: any[] = []
  if (ids.length) {
    const { data } = await sb.from('messages').select('conversation_id,role,content,no_answer,feedback,created_at').in('conversation_id', ids).order('created_at')
    msgs = data || []
  }
  const userMsgs = msgs.filter((m) => m.role === 'user')
  const stats = {
    conversations: (convs || []).length,
    messages: msgs.length,
    user_messages: userMsgs.length,
    escalations: (convs || []).filter((x: any) => ['escalated', 'human'].includes(x.status)).length,
    resolved_by_bot: (convs || []).filter((x: any) => !['escalated', 'human'].includes(x.status)).length,
    no_answer: userMsgs.filter((m) => m.no_answer).length,
    thumbs_up: msgs.filter((m) => m.feedback === 1).length,
    thumbs_down: msgs.filter((m) => m.feedback === -1).length,
    leads: (convs || []).filter((x: any) => x.lead_email).length,
    by_channel: Object.fromEntries(Object.entries((convs || []).reduce((a: any, x: any) => { a[x.channel] = (a[x.channel] || 0) + 1; return a }, {}))),
  }

  // sample for the LLM: all user questions (capped) + unanswered ones + negative-feedback answers
  const questions = userMsgs.map((m) => m.content.replace(/\s+/g, ' ').slice(0, 200)).slice(0, 400)
  const unanswered = userMsgs.filter((m) => m.no_answer).map((m) => m.content.slice(0, 200)).slice(0, 60)
  const negative = msgs.filter((m) => m.feedback === -1).map((m) => m.content.slice(0, 300)).slice(0, 20)

  const prompt = `Sei un analista di customer support. Scrivi un report in italiano, in Markdown, per il management di "${c.name}" relativo al periodo ${start} → ${end}, basato sui dati dell'assistente AI del loro sito.

DATI AGGREGATI (usali nel report, non inventarne altri):
${JSON.stringify(stats, null, 2)}

DOMANDE DEGLI UTENTI (campione):
${questions.map((q) => `- ${q}`).join('\n') || '- (nessuna)'}

DOMANDE A CUI L'ASSISTENTE NON HA SAPUTO RISPONDERE:
${unanswered.map((q) => `- ${q}`).join('\n') || '- (nessuna)'}

RISPOSTE CON FEEDBACK NEGATIVO:
${negative.map((q) => `- ${q}`).join('\n') || '- (nessuna)'}

Struttura richiesta (usa titoli ##):
## Sintesi del periodo  (3-5 righe, numeri chiave)
## Volumi e canali
## Temi più richiesti  (raggruppa le domande in 4-8 temi con una stima della frequenza)
## Domande senza risposta e lacune del sito  (cosa manca sul sito/knowledge base, concreto)
## Escalation e feedback
## Raccomandazioni  (3-6 azioni concrete e prioritizzate: contenuti da aggiungere, FAQ da creare, pagine da chiarire)

Tono professionale, concreto, niente fronzoli. Non menzionare questo prompt. Non inventare dati non presenti.`

  const r = await llm(c.model || 'anthropic/claude-sonnet-5-5', [{ role: 'user', content: prompt }], { temperature: 0.3, max_tokens: 2500 })
  const subject = `${c.name} — Report assistente ${start} → ${end}`
  const { data: report, error } = await sb.from('reports').insert({
    client_id: c.id, period_start: start, period_end: end, subject, body_md: r.text.trim(), stats, recipients: c.report_recipients || [], status: 'draft',
  }).select().single()
  if (error) throw error
  return report
}
