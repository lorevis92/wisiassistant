// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS } from '../_shared/common.ts'

/**
 * Public, used by the Sardesk sign-up page: { email } → { exists: boolean } and nothing else.
 * "exists" = an account with that email and a confirmed address (database function wa_email_has_account, service role).
 * Abuse limits (wa_check_rate_limit, 1-hour windows): 30 checks per IP and 600 in total for the whole service.
 */
const PER_IP = 30
const GLOBAL = 600

function clientIp(req: Request) {
  const fwd = req.headers.get('x-forwarded-for') || ''
  return (req.headers.get('cf-connecting-ip') || fwd.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim().slice(0, 64)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return err('Metodo non consentito', 405)
  let b: any
  try { b = await req.json() } catch { return err('JSON non valido') }
  const email = String(b?.email || '').trim().toLowerCase()
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Email non valida')

  const sb = admin()
  const limit = async (key: string, max: number) => {
    const { data, error } = await sb.rpc('wa_check_rate_limit', { p_key: key, p_limit: max })
    if (error) throw new Error(error.message)
    return data === true
  }
  try {
    if (!(await limit(`check-email:ip:${clientIp(req)}`, PER_IP)) || !(await limit('check-email:global', GLOBAL))) {
      return err('Troppe verifiche: riprova più tardi', 429)
    }
    const { data, error } = await sb.rpc('wa_email_has_account', { p_email: email })
    if (error) throw new Error(error.message)
    return json({ exists: data === true })
  } catch (e) {
    console.error('check-email:', (e as Error).message)
    return err('Verifica non disponibile', 500)
  }
})
