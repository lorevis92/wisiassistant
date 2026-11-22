// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

export const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
export const err = (message: string, status = 400) => json({ error: message }, status)

// ------------------------------------------------------------------ ACCESS CONTROL
// Every check is done here, server side, with the caller's own JWT: the database functions wa_can_access_client /
// wa_is_org_admin (migration 0006) decide, never the frontend. Public widget and channels do not come through here.

const bearer = (req: Request) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()

export function isServiceRole(req: Request) {
  const token = bearer(req)
  return !!token && token === SERVICE_KEY
}

/** Supabase client acting as the caller (RLS and auth.uid() apply). */
export function userClient(req: Request) {
  return createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${bearer(req)}` } }, auth: { persistSession: false } })
}

/** Returns the authenticated user if the request carries a valid user JWT, else null. */
export async function getUser(req: Request) {
  const token = bearer(req)
  if (!token || token === ANON_KEY || token === SERVICE_KEY) return null
  const { data } = await userClient(req).auth.getUser()
  return data.user || null
}

async function rpcBool(req: Request, fn: string, args: Record<string, unknown>) {
  const { data, error } = await userClient(req).rpc(fn, args)
  if (error) {
    console.error(`access check ${fn} failed:`, error.message)
    throw Object.assign(new Error('Controllo accessi non disponibile: esegui la migrazione 0006_organizations.sql'), { status: 500 })
  }
  return data === true
}

/** Gate for one client: service role, or a user who is owner/admin of the client's organization or has it assigned. */
export async function requireClientAccess(req: Request, clientId: unknown): Promise<Response | null> {
  if (isServiceRole(req)) return null
  if (typeof clientId !== 'string' || !/^[0-9a-f-]{36}$/i.test(clientId)) return err('client_id mancante o non valido', 400)
  const user = await getUser(req)
  if (!user) return err('Non autorizzato', 401)
  if (!(await rpcBool(req, 'wa_can_access_client', { p_client: clientId }))) return err('Non hai accesso a questo cliente', 403)
  return null
}

/** Gate for jobs run by the scheduler (pg_cron with the service role key) only. */
export function requireServiceRole(req: Request): Response | null {
  return isServiceRole(req) ? null : err('Riservato al sistema', 403)
}

// ------------------------------------------------------------------ EMBEDDINGS
export async function embed(texts: string[]): Promise<number[][]> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY mancante (serve per gli embedding)')
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 8000))
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message || 'Embedding error')
    for (const d of j.data) out.push(d.embedding)
  }
  return out
}

// ------------------------------------------------------------------ LLM (multi-provider)
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string }
export type LLMResult = { text: string; tokens_in?: number; tokens_out?: number }

export async function llm(modelKey: string, messages: Msg[], opts: { temperature?: number; max_tokens?: number } = {}): Promise<LLMResult> {
  const [provider, ...rest] = modelKey.split('/')
  const model = rest.join('/')
  const temperature = opts.temperature ?? 0.2
  const max_tokens = opts.max_tokens ?? 1024
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const chat = messages.filter((m) => m.role !== 'system')

  const need = (k: string) => { const v = Deno.env.get(k); if (!v) throw new Error(`${k} mancante nei secrets di Supabase`); return v }

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': need('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      // recent Claude models reject `temperature` ("deprecated for this model"): never send it to Anthropic
      body: JSON.stringify({ model, max_tokens, system, messages: chat }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message || 'Anthropic error')
    return { text: (j.content || []).map((c: any) => c.text || '').join(''), tokens_in: j.usage?.input_tokens, tokens_out: j.usage?.output_tokens }
  }

  if (provider === 'google') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${need('GOOGLE_API_KEY')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: system ? { parts: [{ text: system }] } : undefined,
        contents: chat.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature, maxOutputTokens: max_tokens },
      }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message || 'Google error')
    const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
    return { text, tokens_in: j.usageMetadata?.promptTokenCount, tokens_out: j.usageMetadata?.candidatesTokenCount }
  }

  // OpenAI-compatible providers
  const compat: Record<string, { url: string; key: string }> = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY' },
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: 'MISTRAL_API_KEY' },
    xai: { url: 'https://api.x.ai/v1/chat/completions', key: 'XAI_API_KEY' },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY' },
  }
  const c = compat[provider]
  if (!c) throw new Error(`Provider sconosciuto: ${provider}`)
  const body: any = { model, messages: [...(system ? [{ role: 'system', content: system }] : []), ...chat], temperature }
  // newer OpenAI models reject max_tokens → use max_completion_tokens
  if (provider === 'openai') body.max_completion_tokens = max_tokens; else body.max_tokens = max_tokens
  if (provider === 'openai' && isOpenAIReasoning(model)) {
    // reasoning models reject a non-default temperature, and reasoning tokens count against
    // max_completion_tokens: lowest effort (fast support replies) + headroom so the answer is never empty
    delete body.temperature
    body.reasoning_effort = /^gpt-5(-|$)/.test(model) ? 'minimal' : 'low'
    body.max_completion_tokens = Math.max(max_tokens, 2000)
  }
  const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${need(c.key)}` }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message || `${provider} error`)
  return { text: j.choices?.[0]?.message?.content || '', tokens_in: j.usage?.prompt_tokens, tokens_out: j.usage?.completion_tokens }
}

/** OpenAI reasoning models: GPT-5 family (except the non-reasoning *-chat variants) and the o-series. Keep in sync with src/lib/models.js. */
export const isOpenAIReasoning = (model: string) => (/^gpt-5/.test(model) && !/-chat/.test(model)) || /^o\d/.test(model)

// ------------------------------------------------------------------ CHUNKING (shared with manual content)
/** Splits markdown-ish text into chunks by headings, keeping the heading path and an anchor-friendly slug. */
export function chunkMarkdown(text: string, opts: { maxChars?: number } = {}) {
  const maxChars = opts.maxChars ?? 1400
  const lines = text.split('\n')
  const out: { content: string; heading_path: string; anchor: string | null }[] = []
  const stack: { level: number; text: string }[] = []
  let buf: string[] = []
  const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const flush = () => {
    const body = buf.join('\n').trim()
    buf = []
    if (!body) return
    const heading_path = stack.map((s) => s.text).join(' > ')
    const anchor = stack.length ? slug(stack[stack.length - 1].text) : null
    const head = heading_path ? `${heading_path}\n\n` : ''
    // split long sections by paragraphs
    const paras = body.split(/\n\s*\n/)
    let cur = ''
    for (const p of paras) {
      if ((cur + '\n\n' + p).length > maxChars && cur) { out.push({ content: head + cur.trim(), heading_path, anchor }); cur = p }
      else cur = cur ? cur + '\n\n' + p : p
    }
    // hard-split very long single paragraphs at sentence boundaries
    while (cur.length > maxChars * 1.5) {
      let cut = cur.lastIndexOf('. ', maxChars)
      if (cut < maxChars / 3) cut = maxChars
      out.push({ content: head + cur.slice(0, cut + 1).trim(), heading_path, anchor })
      cur = cur.slice(cut + 1)
    }
    if (cur.trim()) out.push({ content: head + cur.trim(), heading_path, anchor })
  }
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) {
      flush()
      const level = m[1].length
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      stack.push({ level, text: m[2].trim() })
    } else buf.push(line)
  }
  flush()
  return out
}

export async function sendEmail(to: string[], subject: string, html: string, text?: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('REPORT_FROM_EMAIL') || 'Sardesk <onboarding@resend.dev>'
  if (!key) throw new Error('RESEND_API_KEY mancante')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html, text }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.message || 'Resend error')
  return j
}

/** Minimal markdown → HTML for emails (headings, bold, lists, links, paragraphs). */
export function mdToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.split('\n')
  let html = ''; let inList = false
  for (const raw of lines) {
    const l = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(l)
    if (h) { if (inList) { html += '</ul>'; inList = false } html += `<h${h[1].length + 1} style="font-weight:600;color:#10232F;margin:18px 0 6px">${esc(h[2])}</h${h[1].length + 1}>`; continue }
    if (/^\s*[-*]\s+/.test(l)) { if (!inList) { html += '<ul style="margin:6px 0 10px 18px;padding:0">'; inList = true } html += `<li style="margin:3px 0">${inline(esc(l.replace(/^\s*[-*]\s+/, '')))}</li>`; continue }
    if (inList) { html += '</ul>'; inList = false }
    if (!l.trim()) continue
    html += `<p style="margin:6px 0;line-height:1.5">${inline(esc(l))}</p>`
  }
  if (inList) html += '</ul>'
  return html
  function inline(s: string) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  }
}
