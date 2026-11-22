// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, getUser, userClient, sendEmail } from '../_shared/common.ts'

/**
 * Delivers an invitation (migration 0007). The Team page calls it right after creating / renewing an invite.
 *
 *  { mode: 'status' }        → { resend: boolean }  (tells the invite dialog whether Resend is configured)
 *  { invite_id, token }      → sends the email:
 *     - no account for that email (target_existed = false): Supabase Auth invite (inviteUserByEmail, no setup needed).
 *       The person sets a password on /welcome; once the email is verified they join automatically (wa_claim_invites).
 *     - account already there (target_existed = true): email via Resend if configured; in any case the invite is shown
 *       in the app ("Inviti ricevuti") with Accept / Decline.
 *     If the Supabase invite fails (e.g. an unconfirmed account already exists) Resend is used when configured.
 *
 * Security: the caller must see the invite through RLS (org owner/admin, or the collaborator who created it) and the
 * token must match the stored hash (only who just created / renewed it has it). Links are built server side.
 */
async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hasResend = () => !!Deno.env.get('RESEND_API_KEY')

function emailHtml(org: string, role: string, link: string, expires: string, existing: boolean) {
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#141824;max-width:560px">
    <div style="font-weight:700;font-size:18px;letter-spacing:-0.02em;margin-bottom:14px">Sardesk</div>
    <p>Sei stato invitato in <b>${esc(org)}</b> su Sardesk come <b>${role}</b>.</p>
    <p>${existing ? 'Accedi con il tuo account: troverai l’invito in “Inviti ricevuti”, oppure usa il pulsante qui sotto.' : 'Crea il tuo account con questo indirizzo email per entrare.'}</p>
    <p style="margin:22px 0"><a href="${esc(link)}" style="background:linear-gradient(115deg,#22E6D6,#8B6CFF);color:#04070C;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Apri l'invito</a></p>
    <p style="font-size:13px;color:#4A5266">L'invito scade il ${expires}. Se non lo aspettavi puoi ignorare questa email.</p></div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let b: any
  try { b = await req.json() } catch { return err('JSON non valido') }
  const user = await getUser(req)
  if (!user) return err('Non autorizzato', 401)
  if (b.mode === 'status') return json({ resend: hasResend() })

  const { data: inv } = await userClient(req).from('wa_invites')
    .select('id,email,role,token_hash,expires_at,accepted_at,revoked_at,declined_at,target_existed,org:wa_organizations(name)')
    .eq('id', b.invite_id).maybeSingle()
  if (!inv) return err('Invito non trovato', 404)
  if (inv.accepted_at || inv.revoked_at || inv.declined_at || new Date(inv.expires_at) <= new Date()) return err('Invito non più valido', 400)
  if (typeof b.token !== 'string' || (await sha256(b.token)) !== inv.token_hash) return err('Link non valido', 403)

  const origin = req.headers.get('Origin') || ''
  const base = (Deno.env.get('PUBLIC_APP_URL') || (/^https?:\/\/[^\s/]+$/i.test(origin) ? origin : '')).replace(/\/+$/, '')
  const org = (inv as any).org?.name || 'Sardesk'
  const role = inv.role === 'admin' ? 'amministratore' : 'collaboratore'
  const expires = new Date(inv.expires_at).toLocaleDateString('it-CH')
  const link = `${base}/invite/${b.token}`
  const sb = admin()
  const record = (patch: Record<string, unknown>) => sb.from('wa_invites').update(patch).eq('id', inv.id)

  const viaResend = async (existing: boolean) => {
    await sendEmail([inv.email], `Invito a ${org} su Sardesk`, emailHtml(org, role, link, expires, existing), `Invito a ${org} su Sardesk: ${link}`)
    await record({ email_sent_at: new Date().toISOString(), email_channel: 'resend', email_error: null })
    return json({ sent: true, channel: 'resend', in_app: existing, resend: true })
  }

  try {
    if (inv.target_existed === false) {
      // new account: Supabase Auth invitation email (template "Invite user" of the project)
      const { error } = await sb.auth.admin.inviteUserByEmail(inv.email, {
        redirectTo: base ? `${base}/welcome` : undefined,
        data: { invited_by_app: 'sardesk' },
      })
      if (!error) {
        await record({ email_sent_at: new Date().toISOString(), email_channel: 'supabase', email_error: null })
        return json({ sent: true, channel: 'supabase', in_app: false, resend: hasResend() })
      }
      console.warn('inviteUserByEmail failed:', error.message)
      if (hasResend()) return await viaResend(false)
      await record({ email_error: error.message })
      return json({ sent: false, channel: null, in_app: false, resend: false, reason: error.message })
    }
    // existing account: in-app notification is always there; email only with Resend
    if (hasResend()) return await viaResend(true)
    await record({ email_error: 'Resend non configurato' })
    return json({ sent: false, channel: null, in_app: true, resend: false, reason: 'Resend non configurato' })
  } catch (e) {
    await record({ email_error: (e as Error).message })
    return json({ sent: false, channel: null, in_app: inv.target_existed === true, resend: hasResend(), reason: (e as Error).message })
  }
})
