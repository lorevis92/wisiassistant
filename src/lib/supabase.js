import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const CRAWLER_URL = (import.meta.env.VITE_CRAWLER_URL || '').replace(/\/$/, '')

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

/** Calls a Supabase Edge Function with the current session token. */
export async function callFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) throw new Error(json.error || json.message || `Errore ${res.status}`)
  return json
}

/** Calls the crawler service (Railway) with the admin session token. */
export async function callCrawler(path, body, method = 'POST') {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${CRAWLER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.detail || json.error || `Errore crawler ${res.status}`)
  return json
}
