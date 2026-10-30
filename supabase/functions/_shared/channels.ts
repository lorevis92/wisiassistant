// deno-lint-ignore-file no-explicit-any
/**
 * Channel adapters: deliver an outbound message (bot or operator) to the external channel of a conversation.
 * web / standalone: nothing to do (the widget receives the reply in the HTTP response or via polling).
 * telegram: Bot API sendMessage.  whatsapp / instagram / messenger: Meta Cloud API (same shape).
 * email: handled as plain reply via Resend when the conversation came from email.
 */

/** Converts markdown links to channel-friendly text. */
function plainLinks(text: string) {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2')
}

export async function deliverToChannel(client: any, conv: any, text: string) {
  try {
    switch (conv.channel) {
      case 'telegram': return await telegramSend(client.telegram_bot_token, conv.external_id, text)
      case 'whatsapp': return await metaSend(client, conv.external_id, plainLinks(text), 'whatsapp')
      case 'instagram':
      case 'messenger': return await metaSend(client, conv.external_id, plainLinks(text), conv.channel)
      case 'email': return await emailReply(client, conv, text)
      default: return
    }
  } catch (e) {
    console.error(`[deliver:${conv.channel}]`, (e as Error).message)
  }
}

export async function telegramSend(token: string, chatId: string, text: string) {
  if (!token || !chatId) return
  // Telegram MarkdownV2 is painful; send HTML with links.
  const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: false }),
  })
  if (!r.ok) throw new Error(await r.text())
}

export async function metaSend(client: any, to: string, text: string, channel: 'whatsapp' | 'instagram' | 'messenger') {
  const token = client.whatsapp_token
  if (!token || !to) return
  if (channel === 'whatsapp') {
    const r = await fetch(`https://graph.facebook.com/v21.0/${client.whatsapp_phone_id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: true } }),
    })
    if (!r.ok) throw new Error(await r.text())
  } else {
    // Messenger / Instagram Send API (page-scoped). Uses the same access token field; the page id lives in whatsapp_phone_id for simplicity.
    const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: to }, message: { text } }),
    })
    if (!r.ok) throw new Error(await r.text())
  }
}

async function emailReply(client: any, conv: any, text: string) {
  const { sendEmail } = await import('./common.ts')
  if (!conv.lead_email) return
  await sendEmail([conv.lead_email], `Re: ${client.name}`, `<div style="font-family:system-ui;font-size:14px">${text.replace(/\n/g, '<br>')}</div>`, text)
}
