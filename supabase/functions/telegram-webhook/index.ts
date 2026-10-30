// deno-lint-ignore-file no-explicit-any
import { admin, json } from '../_shared/common.ts'
import { runMessage } from '../_shared/rag.ts'

/**
 * Telegram webhook. Register once per client (after saving the bot token in Settings):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook?client=<SLUG>&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 * Deploy with: supabase functions deploy telegram-webhook --no-verify-jwt
 */
Deno.serve(async (req) => {
  const url = new URL(req.url)
  const slug = url.searchParams.get('client')
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) return json({ error: 'forbidden' }, 403)
  if (!slug) return json({ error: 'client mancante' }, 400)

  let update: any
  try { update = await req.json() } catch { return json({ ok: true }) }
  const msg = update.message || update.edited_message
  if (!msg?.text) return json({ ok: true })

  const sb = admin()
  const { data: client } = await sb.from('wa_clients').select('*').eq('slug', slug).maybeSingle()
  if (!client || !(client.channels || []).includes('telegram')) return json({ ok: true })

  const chatId = String(msg.chat.id)
  const label = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || `tg-${chatId}`
  const text = msg.text === '/start' ? null : msg.text

  if (!text) {
    const { telegramSend } = await import('../_shared/channels.ts')
    await telegramSend(client.telegram_bot_token, chatId, client.widget?.welcome || `Ciao! Sono l'assistente di ${client.name}. Come posso aiutarti?`)
    return json({ ok: true })
  }

  try {
    await runMessage(sb, client, { content: text, channel: 'telegram', external_id: chatId, visitor_label: label })
  } catch (e) {
    console.error(e)
    const { telegramSend } = await import('../_shared/channels.ts')
    await telegramSend(client.telegram_bot_token, chatId, 'Si è verificato un errore, riprova tra poco.').catch(() => {})
  }
  return json({ ok: true })
})
