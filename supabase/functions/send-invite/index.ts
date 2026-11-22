// deno-lint-ignore-file no-explicit-any
import { json, err, CORS, getUser, userClient, sendEmail } from '../_shared/common.ts'

/**
 * Emails an invitation link (optional: the Team page always shows the link to copy).
 * { invite_id, token }  — the caller must be allowed to see the invite (RLS: org owner/admin or the collaborator who
 * created it) and the token must match the stored hash, so only whoever just created / renewed it can send it.
 * The link is built server side from PUBLIC_APP_URL (or the caller's Origin), never taken from the request body.
 */
async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let b: any
  try { b = await req.json() } catch { return err('JSON non valido') }
  const user = await getUser(req)
  if (!user) return err('Non autorizzato', 401)
  if (!Deno.env.get('RESEND_API_KEY')) return json({ sent: false, reason: 'Email non configurata (RESEND_API_KEY)' })

  const sb = userClient(req)
  const { data: inv } = await sb.from('wa_invites').select('id,email,role,token_hash,expires_at,accepted_at,revoked_at,org:wa_organizations(name)').eq('id', b.invite_id).maybeSingle()
  if (!inv) return err('Invito non trovato', 404)
  if (inv.accepted_at || inv.revoked_at || new Date(inv.expires_at) <= new Date()) return err('Invito non più valido', 400)
  if (typeof b.token !== 'string' || (await sha256(b.token)) !== inv.token_hash) return err('Link non valido', 403)

  const origin = req.headers.get('Origin') || ''
  const base = (Deno.env.get('PUBLIC_APP_URL') || (/^https?:\/\/[^\s/]+$/i.test(origin) ? origin : '')).replace(/\/+$/, '')
  if (!base) return json({ sent: false, reason: 'PUBLIC_APP_URL non impostato' })
  const link = `${base}/invite/${b.token}`
  const org = (inv as any).org?.name || 'Sardesk'
  const role = inv.role === 'admin' ? 'amministratore' : 'collaboratore'
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#141824;max-width:560px">
    <div style="font-weight:700;font-size:18px;letter-spacing:-0.02em;margin-bottom:14px">Sardesk</div>
    <p>Sei stato invitato in <b>${esc(org)}</b> su Sardesk come <b>${role}</b>.</p>
    <p style="margin:22px 0"><a href="${esc(link)}" style="background:linear-gradient(115deg,#22E6D6,#8B6CFF);color:#04070C;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Accetta l'invito</a></p>
    <p style="font-size:13px;color:#4A5266">Il link vale una sola volta e scade il ${new Date(inv.expires_at).toLocaleDateString('it-CH')}. Se non aspettavi questo invito puoi ignorare l'email.</p></div>`
  try {
    await sendEmail([inv.email], `Invito a ${org} su Sardesk`, html, `Accetta l'invito a ${org} su Sardesk: ${link}`)
    return json({ sent: true })
  } catch (e) {
    return json({ sent: false, reason: (e as Error).message })
  }
})
