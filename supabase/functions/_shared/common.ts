// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// one service client per isolate: warm requests reuse it (and its HTTP connections) instead of building a new one
let _admin: any = null
export const admin = () => (_admin ??= createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }))

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

// ------------------------------------------------------------------ LLM (multi-provider, streaming)
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string }
export type LLMResult = { text: string; tokens_in?: number; tokens_out?: number; ttft_ms?: number; ms?: number }
export type LLMOpts = {
  temperature?: number
  max_tokens?: number
  /** least reasoning the model allows (chat answers, query rewrite): see anthropicLatency / openaiEffort / googleThinking */
  fast?: boolean
  /** abort the whole call after this many ms */
  timeout_ms?: number
  /** abort if the first token has not arrived after this many ms */
  first_token_timeout_ms?: number
}

/** OpenAI reasoning models: GPT-5 family (except the non-reasoning *-chat variants) and the o-series. Keep in sync with src/lib/models.js. */
export const isOpenAIReasoning = (model: string) => (/^gpt-5/.test(model) && !/-chat/.test(model)) || /^o\d/.test(model)

/**
 * Smallest, fastest model of the same provider (same API key), for the query rewrite.
 * The provider of the client's model is used so no extra secret is needed.
 */
export function fastModelFor(modelKey: string) {
  const provider = modelKey.split('/')[0]
  const fast: Record<string, string> = {
    anthropic: 'anthropic/claude-haiku-5-5',
    openai: 'openai/gpt-5-nano',
    google: 'google/gemini-2.5-flash-lite',
    mistral: 'mistral/mistral-small-latest',
    xai: 'xai/grok-4-fast-non-reasoning',
    groq: 'groq/llama-3.1-8b-instant',
  }
  return fast[provider] || modelKey
}

/**
 * Least reasoning each model accepts. Reasoning ("thinking") happens before the first word: for short support
 * answers grounded in the given context it adds seconds and no quality.
 *  - Claude 5 family: effort low; thinking off where the model allows it (Haiku 5.x, Sonnet 5, Opus 5: `disabled`;
 *    Sonnet 5.5+: `between_tools`, i.e. no thinking without tools; Opus 5.5 / Fable: always on, effort low is the minimum)
 *  - OpenAI reasoning models: reasoning_effort minimal (gpt-5) / none (gpt-5.1+) / low (o-series)
 *  - Gemini 2.5 Flash: thinking budget 0; 2.5 Pro: 128 (its minimum); Gemini 3: thinking level low
 */
function anthropicLatency(model: string) {
  const m = model.match(/^claude-(haiku|sonnet|opus|fable|mythos)-(\d+)(?:-(\d+))?/)
  if (!m || Number(m[2]) < 5) return {}
  const family = m[1]
  const minor = Number(m[3] || 0)
  const out: any = { output_config: { effort: 'low' } }
  if (family === 'haiku' || (family === 'opus' && minor === 0) || (family === 'sonnet' && minor === 0)) out.thinking = { type: 'disabled' }
  else if (family === 'sonnet') out.thinking = { type: 'between_tools' }
  return out
}
function openaiEffort(model: string) {
  if (/^gpt-5(-|$)/.test(model)) return 'minimal'
  if (/^gpt-5\.\d/.test(model)) return 'none'
  return 'low'
}
function googleThinking(model: string) {
  if (/gemini-2\.5-.*flash/.test(model)) return { thinkingBudget: 0 }
  if (/gemini-2\.5-pro/.test(model)) return { thinkingBudget: 128 }
  if (/gemini-3/.test(model)) return { thinkingLevel: 'low' }
  return null
}

const need = (k: string) => { const v = Deno.env.get(k); if (!v) throw new Error(`${k} mancante nei secrets di Supabase`); return v }
const COMPAT: Record<string, { url: string; key: string }> = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY' },
  mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: 'MISTRAL_API_KEY' },
  xai: { url: 'https://api.x.ai/v1/chat/completions', key: 'XAI_API_KEY' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY' },
}

/** Builds the provider request. `stream` selects the streaming endpoint / flag. */
export function buildRequest(modelKey: string, messages: Msg[], opts: LLMOpts, stream: boolean) {
  const [provider, ...rest] = modelKey.split('/')
  const model = rest.join('/')
  const temperature = opts.temperature ?? 0.2
  const max_tokens = opts.max_tokens ?? 1024
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const chat = messages.filter((m) => m.role !== 'system')

  if (provider === 'anthropic') {
    // recent Claude models reject `temperature` ("deprecated for this model"): never send it to Anthropic
    const body: any = { model, max_tokens, system, messages: chat, ...(opts.fast ? anthropicLatency(model) : {}) }
    if (stream) body.stream = true
    return { provider, url: 'https://api.anthropic.com/v1/messages', headers: { 'Content-Type': 'application/json', 'x-api-key': need('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, body }
  }

  if (provider === 'google') {
    const thinking = opts.fast ? googleThinking(model) : null
    const body = {
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: chat.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature, maxOutputTokens: max_tokens, ...(thinking ? { thinkingConfig: thinking } : {}) },
    }
    const method = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'
    return { provider, url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}key=${need('GOOGLE_API_KEY')}`, headers: { 'Content-Type': 'application/json' }, body }
  }

  // OpenAI-compatible providers
  const c = COMPAT[provider]
  if (!c) throw new Error(`Provider sconosciuto: ${provider}`)
  const body: any = { model, messages: [...(system ? [{ role: 'system', content: system }] : []), ...chat], temperature }
  // newer OpenAI models reject max_tokens → use max_completion_tokens
  if (provider === 'openai') body.max_completion_tokens = max_tokens; else body.max_tokens = max_tokens
  if (provider === 'openai' && isOpenAIReasoning(model)) {
    // reasoning models reject a non-default temperature, and reasoning tokens count against
    // max_completion_tokens: lowest effort (fast support replies) + headroom so the answer is never empty
    delete body.temperature
    body.reasoning_effort = openaiEffort(model)
    body.max_completion_tokens = Math.max(max_tokens, 2000)
  }
  if (stream) {
    body.stream = true
    if (provider === 'openai') body.stream_options = { include_usage: true }
  }
  return { provider, url: c.url, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${need(c.key)}` }, body }
}

function apiError(provider: string, status: number, j: any) {
  const msg = j?.error?.message || j?.message || (Array.isArray(j) ? j[0]?.error?.message : '') || `${provider} error (${status})`
  return Object.assign(new Error(msg), { status: status >= 500 ? 502 : status })
}

/** Non-streaming call (reports, query rewrite). */
export async function llm(modelKey: string, messages: Msg[], opts: LLMOpts = {}): Promise<LLMResult> {
  const r = buildRequest(modelKey, messages, opts, false)
  const t0 = performance.now()
  const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: opts.timeout_ms ? AbortSignal.timeout(opts.timeout_ms) : undefined })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw apiError(r.provider, res.status, j)
  const ms = Math.round(performance.now() - t0)
  if (r.provider === 'anthropic') return { text: (j.content || []).map((c: any) => (c.type === 'text' ? c.text : '')).join(''), tokens_in: j.usage?.input_tokens, tokens_out: j.usage?.output_tokens, ms }
  if (r.provider === 'google') return { text: j.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text || '').join('') || '', tokens_in: j.usageMetadata?.promptTokenCount, tokens_out: j.usageMetadata?.candidatesTokenCount, ms }
  return { text: j.choices?.[0]?.message?.content || '', tokens_in: j.usage?.prompt_tokens, tokens_out: j.usage?.completion_tokens, ms }
}

/** Server-sent events → the `data:` payload of each event (JSON-parsed; '[DONE]' and comments skipped). */
export async function* sseData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
        if (!data || data === '[DONE]') continue
        try { yield JSON.parse(data) } catch { /* partial / non-JSON keep-alive */ }
      }
    }
  } finally { reader.releaseLock() }
}

/**
 * Streaming call: `onDelta` gets each piece of text as soon as the provider sends it.
 * Returns the full text, usage, time to first token (ttft_ms) and total time (ms), measured from the request start.
 * An error after some text has arrived is thrown with `partial` (the text so far), so the caller can keep it.
 */
export async function llmStream(modelKey: string, messages: Msg[], opts: LLMOpts = {}, onDelta?: (t: string) => void): Promise<LLMResult> {
  const r = buildRequest(modelKey, messages, opts, true)
  const ctrl = new AbortController()
  const total = opts.timeout_ms ? setTimeout(() => ctrl.abort(new Error('Il modello non ha completato la risposta in tempo')), opts.timeout_ms) : null
  const first = opts.first_token_timeout_ms ? setTimeout(() => ctrl.abort(new Error('Il modello non ha iniziato a rispondere in tempo')), opts.first_token_timeout_ms) : null
  const t0 = performance.now()
  let text = ''
  let ttft: number | undefined
  let tokens_in: number | undefined
  let tokens_out: number | undefined
  const push = (t: string) => {
    if (!t) return
    if (ttft === undefined) { ttft = Math.round(performance.now() - t0); if (first) clearTimeout(first) }
    text += t
    onDelta?.(t)
  }
  try {
    const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: ctrl.signal })
    if (!res.ok || !res.body) throw apiError(r.provider, res.status, await res.json().catch(() => ({})))
    for await (const ev of sseData(res.body)) {
      if (r.provider === 'anthropic') {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') push(ev.delta.text)
        else if (ev.type === 'message_start') tokens_in = ev.message?.usage?.input_tokens
        else if (ev.type === 'message_delta') tokens_out = ev.usage?.output_tokens ?? tokens_out
        else if (ev.type === 'error') throw new Error(ev.error?.message || 'Anthropic error')
      } else if (r.provider === 'google') {
        if (ev.error) throw new Error(ev.error.message || 'Google error')
        for (const p of ev.candidates?.[0]?.content?.parts || []) if (!p.thought) push(p.text || '')
        if (ev.usageMetadata) { tokens_in = ev.usageMetadata.promptTokenCount; tokens_out = ev.usageMetadata.candidatesTokenCount }
      } else {
        if (ev.error) throw new Error(ev.error.message || `${r.provider} error`)
        push(ev.choices?.[0]?.delta?.content || '')
        const u = ev.usage || ev.x_groq?.usage
        if (u) { tokens_in = u.prompt_tokens; tokens_out = u.completion_tokens }
      }
    }
  } catch (e) {
    const reason = ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason : e
    throw Object.assign(reason as Error, { partial: text, ttft_ms: ttft })
  } finally {
    if (total) clearTimeout(total)
    if (first) clearTimeout(first)
  }
  return { text, tokens_in, tokens_out, ttft_ms: ttft, ms: Math.round(performance.now() - t0) }
}

// ------------------------------------------------------------------ TIMINGS
/**
 * Per-answer timings shown in "Perché ha risposto così": every step with its start (ms from the request start) and
 * duration, so overlapping (parallel) steps read as a waterfall.
 */
export class Timer {
  t0: number
  steps: { key: string; start: number; ms: number }[] = []
  info: Record<string, unknown> = {}
  constructor(t0 = performance.now()) { this.t0 = t0 }
  async time<T>(key: string, p: Promise<T> | (() => Promise<T>)): Promise<T> {
    const s = performance.now()
    try { return await (typeof p === 'function' ? p() : p) } finally { this.add(key, s, performance.now()) }
  }
  add(key: string, start: number, end: number) {
    this.steps.push({ key, start: Math.max(0, Math.round(start - this.t0)), ms: Math.max(0, Math.round(end - start)) })
  }
  json() { return { steps: [...this.steps].sort((a, b) => a.start - b.start), total_ms: Math.round(performance.now() - this.t0), ...this.info } }
}

// ------------------------------------------------------------------ CHUNKING (manual content; same rules as crawler/chunking.py)
/**
 * Structure-aware chunks: every chunk starts with a context header ("Documento: <title>", "Sezione: <H1 > H2>") so it
 * can be understood and found on its own; sections split by headings; small sibling sections (FAQ items) kept together;
 * long sections split by paragraph with a short overlap; lists and tables never cut mid-row, long tables repeat their
 * header row in every part.
 */
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const LIST_ITEM = /^\s*([-*+•]|\d+[.)])\s+/

function mdBlocks(body: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let kind: string | null = null
  const close = () => { if (cur.length) blocks.push(cur.join('\n').trim()); cur = []; kind = null }
  for (const line of body.split('\n')) {
    if (!line.trim()) { if (kind === 'table' || kind === 'list') continue; close(); continue }
    let k = TABLE_ROW.test(line) ? 'table' : LIST_ITEM.test(line) ? 'list' : 'text'
    if (kind === 'list' && k === 'text' && /^[ \t]/.test(line)) k = 'list'
    if (kind === null) kind = k
    else if (k !== kind) {
      if (kind === 'text' && k !== 'text' && cur.length <= 2 && cur.join(' ').length < 220) kind = k // lead-in stays with its list
      else { close(); kind = k }
    }
    cur.push(line)
  }
  close()
  return blocks.filter(Boolean)
}

function splitLong(block: string, max: number): string[] {
  if (block.length <= max) return [block]
  const lines = block.split('\n')
  if (TABLE_ROW.test(lines[0])) {
    const head = lines.length > 1 && TABLE_SEP.test(lines[1]) ? lines.slice(0, 2) : lines.slice(0, 1)
    const parts: string[] = []
    let cur = [...head]
    for (const r of lines.slice(head.length)) {
      if (cur.join('\n').length + r.length > max && cur.length > head.length) { parts.push(cur.join('\n')); cur = [...head] }
      cur.push(r)
    }
    parts.push(cur.join('\n'))
    return parts
  }
  if (lines.length > 1) {
    const parts: string[] = []
    let cur = ''
    for (const ln of lines) { if (cur && cur.length + ln.length + 1 > max) { parts.push(cur); cur = ln } else cur = cur ? `${cur}\n${ln}` : ln }
    return cur ? [...parts, cur] : parts
  }
  const parts: string[] = []
  let cur = block
  while (cur.length > max) {
    let cut = cur.lastIndexOf('. ', max)
    cut = cut > max / 3 ? cut + 1 : max
    parts.push(cur.slice(0, cut).trim()); cur = cur.slice(cut).trim()
  }
  return cur ? [...parts, cur] : parts
}

export function chunkMarkdown(text: string, opts: { maxChars?: number; title?: string; label?: string } = {}) {
  const max = opts.maxChars ?? 1800, minChars = 220, overlap = 320
  const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  type Sec = { path: string[]; body: string }
  const sections: Sec[] = []
  const stack: { level: number; text: string }[] = []
  let buf: string[] = []
  const push = () => { const body = buf.join('\n').trim(); if (body) sections.push({ path: stack.map((s) => s.text), body }); buf = [] }
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (m) {
      push()
      const level = m[1].length
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      stack.push({ level, text: m[2].trim() })
    } else buf.push(line)
  }
  push()

  // small sibling sections (FAQ items, short cards) stay together
  const groups: Sec[][] = []
  for (const s of sections) {
    const g = groups[groups.length - 1]
    if (g) {
      const parent = g[0].path.slice(0, -1).join('>')
      const size = g.reduce((a, x) => a + x.body.length + (x.path[x.path.length - 1] || '').length + 8, 0)
      if (s.path.slice(0, -1).join('>') === parent && s.path.length === g[0].path.length && size + s.body.length < max
          && s.body.length < minChars && g.every((x) => x.body.length < minChars)) { g.push(s); continue }
    }
    groups.push([s])
  }

  const out: { content: string; heading_path: string; anchor: string | null }[] = []
  const label = opts.label || 'Documento'
  for (const g of groups) {
    const single = g.length === 1
    const path = single ? g[0].path : g[0].path.slice(0, -1)
    const heading_path = path.join(' > ')
    const blocks = single ? mdBlocks(g[0].body) : g.map((s) => (s.path.length ? `${s.path[s.path.length - 1]}\n${s.body}` : s.body))
    const anchor = g[0].path.length ? slug(g[0].path[g[0].path.length - 1]) : null
    const header = [opts.title ? `${label}: ${opts.title}` : '', heading_path && heading_path !== opts.title ? `Sezione: ${heading_path}` : ''].filter(Boolean).join('\n')
    const room = max - header.length - 2
    const pieces = blocks.flatMap((b) => splitLong(b, room))
    let cur: string[] = []
    const emit = () => out.push({ content: (header ? `${header}\n\n` : '') + cur.join('\n\n'), heading_path, anchor })
    for (const p of pieces) {
      if (cur.length && cur.reduce((a, x) => a + x.length + 2, 0) + p.length > room) {
        emit()
        const last = cur[cur.length - 1]
        cur = last.length <= overlap && !TABLE_ROW.test(last.split('\n')[0]) ? [last] : []
      }
      cur.push(p)
    }
    if (cur.length) emit()
  }
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
