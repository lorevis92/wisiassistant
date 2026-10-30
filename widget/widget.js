/**
 * WISI Assistant embeddable widget (vanilla JS, no deps).
 * Usage on the client's site:
 *   <script src="https://YOUR-DOMAIN/widget.js" data-client="CLIENT_SLUG" async></script>
 * Optional: data-supabase-url / data-anon-key override the values baked in at build time.
 */
;(function () {
  if (window.__wisiAssistantLoaded) return
  window.__wisiAssistantLoaded = true

  const script = document.currentScript || Array.from(document.scripts).find((s) => (s.src || '').includes('widget.js'))
  const slug = script?.dataset.client
  if (!slug) return console.warn('[WISI Assistant] data-client mancante')

  const SUPABASE_URL = script.dataset.supabaseUrl || __WA_SUPABASE_URL__
  const ANON = script.dataset.anonKey || __WA_ANON_KEY__
  const API = `${SUPABASE_URL}/functions/v1/chat`

  const api = async (body) => {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }, body: JSON.stringify(body) })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'Errore')
    return j
  }

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const render = (t) => {
    let out = esc(t)
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, a, u) => `<a href="${u}" target="_blank" rel="noopener">${a}</a>`)
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    return out.replace(/\n/g, '<br>')
  }

  const storeKey = `wa-conv-${slug}`
  let convId = sessionStorage.getItem(storeKey) || null
  let msgs = []
  let cfg = null
  let busy = false
  let leadDone = false
  let lead = {}
  let open = false
  let pollTimer = null
  let lastId = null // id of the last server-side message we hold (for polling)

  async function init() {
    try { cfg = await api({ mode: 'config', client_slug: slug, channel: 'web', origin: location.hostname }) } catch (e) { return console.warn('[WISI Assistant]', e.message) }
    build()
  }

  function build() {
    const color = cfg.widget?.color || '#E8352A'
    const pos = cfg.widget?.position === 'left' ? 'left:20px' : 'right:20px'
    const host = document.createElement('div')
    host.id = 'wisi-assistant-root'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
  :host{all:initial}
  *{box-sizing:border-box;font-family:'Syne',system-ui,sans-serif}
  .launcher{position:fixed;bottom:20px;${pos};width:56px;height:56px;border-radius:50%;background:${color};color:#fff;border:none;box-shadow:0 6px 20px rgba(0,0,0,.18);cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center;font-size:24px}
  .panel{position:fixed;bottom:88px;${pos};width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 110px);background:#fff;border:1px solid #E8E8E8;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:2147483000;display:none;flex-direction:column;overflow:hidden}
  .panel.open{display:flex}
  .head{background:${color};color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}
  .head img{width:28px;height:28px;border-radius:50%}
  .head .t{font-weight:800;text-transform:uppercase;font-size:13px;letter-spacing:.03em}
  .head .s{font-size:11px;opacity:.85}
  .head button{margin-left:auto;background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
  .body{flex:1;overflow:auto;padding:14px;background:#F8F8F8;display:flex;flex-direction:column;gap:8px}
  .m{max-width:84%;padding:9px 12px;border-radius:8px;font-size:13px;line-height:1.45;word-break:break-word}
  .m.user{align-self:flex-end;background:${color};color:#fff;border-bottom-right-radius:2px}
  .m.assistant{align-self:flex-start;background:#fff;border:1px solid #E8E8E8;border-bottom-left-radius:2px;color:#111}
  .m.human{align-self:flex-start;background:#fff;border:1px solid ${color}55;border-bottom-left-radius:2px;color:#111}
  .m a{color:inherit;text-decoration:underline}
  .fb{display:flex;gap:6px;margin-top:4px}
  .fb button{background:none;border:none;cursor:pointer;opacity:.5;font-size:12px;padding:0}
  .fb button.on{opacity:1}
  .sug{display:flex;flex-wrap:wrap;gap:6px}
  .sug button{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:6px 10px;border:1px solid #E8E8E8;background:#fff;border-radius:3px;cursor:pointer;color:#111}
  form.in{display:flex;gap:8px;padding:10px;border-top:1px solid #E8E8E8;background:#fff}
  form.in input{flex:1;padding:9px 11px;border:1px solid #E8E8E8;border-radius:3px;font-size:13px;outline:none}
  form.in input:focus{border-color:${color}}
  form.in button{background:${color};color:#fff;border:none;border-radius:3px;padding:0 14px;font-weight:700;text-transform:uppercase;font-size:11px;cursor:pointer}
  .lead{padding:16px;display:flex;flex-direction:column;gap:10px}
  .lead label{font-size:11px;font-weight:700;text-transform:uppercase;color:#666}
  .lead input{padding:9px 11px;border:1px solid #E8E8E8;border-radius:3px;font-size:13px}
  .lead button{background:${color};color:#fff;border:none;border-radius:3px;padding:10px;font-weight:700;text-transform:uppercase;font-size:11px;cursor:pointer}
  .pw{text-align:center;font-size:9px;color:#AAA;padding:4px 0 6px;background:#fff}
  .typing{align-self:flex-start;color:#AAA;font-size:12px}
</style>
<button class="launcher" aria-label="Apri chat">&#x1F4AC;</button>
<div class="panel">
  <div class="head">${cfg.widget?.avatar_url ? `<img src="${esc(cfg.widget.avatar_url)}" alt="">` : ''}<div><div class="t">${esc(cfg.widget?.title || 'Assistente')}</div><div class="s">${esc(cfg.name)}</div></div><button class="close" aria-label="Chiudi">&#x2715;</button></div>
  <div class="body"></div>
  <form class="in"><input placeholder="Scrivi un messaggio&hellip;" autocomplete="off"><button>Invia</button></form>
  <div class="pw">Powered by WISI Assistant</div>
</div>`
    document.body.appendChild(host)

    const $ = (s) => shadow.querySelector(s)
    const body = $('.body'), form = $('form.in'), input = $('form.in input'), panel = $('.panel')
    $('.launcher').onclick = () => { open = !open; panel.classList.toggle('open', open); $('.launcher').textContent = open ? '\u2715' : '\uD83D\uDCAC'; if (open) { input.focus(); if (!msgs.length) start() } }
    $('.close').onclick = () => $('.launcher').click()

    function start() {
      if (cfg.widget?.lead_capture === 'before' && !leadDone) return showLead(() => { paint(); input.focus() })
      msgs.push({ role: 'assistant', content: cfg.widget?.welcome || 'Ciao! Come posso aiutarti?' })
      paint()
    }

    function showLead(done) {
      body.innerHTML = `<form class="lead"><label>Nome</label><input name="name" required><label>Email</label><input name="email" type="email" required><button>Inizia la chat</button></form>`
      body.querySelector('form').onsubmit = (e) => { e.preventDefault(); const fd = new FormData(e.target); lead = { name: fd.get('name'), email: fd.get('email') }; leadDone = true; msgs.push({ role: 'assistant', content: cfg.widget?.welcome || 'Ciao! Come posso aiutarti?' }); done() }
    }

    function paint() {
      body.innerHTML = ''
      for (const m of msgs) {
        const d = document.createElement('div'); d.className = `m ${m.role}`; d.innerHTML = render(m.content)
        if (m.role === 'assistant' && m.id) {
          const fb = document.createElement('div'); fb.className = 'fb'
          fb.innerHTML = `<button data-v="1" class="${m.feedback === 1 ? 'on' : ''}">&#x1F44D;</button><button data-v="-1" class="${m.feedback === -1 ? 'on' : ''}">&#x1F44E;</button>`
          fb.querySelectorAll('button').forEach((b) => (b.onclick = async () => { m.feedback = Number(b.dataset.v); paint(); try { await api({ mode: 'feedback', message_id: m.id, value: m.feedback }) } catch {} }))
          d.appendChild(fb)
        }
        body.appendChild(d)
      }
      if (msgs.length === 1 && cfg.widget?.suggestions?.length) {
        const s = document.createElement('div'); s.className = 'sug'
        for (const q of cfg.widget.suggestions) { const b = document.createElement('button'); b.textContent = q; b.onclick = () => send(q); s.appendChild(b) }
        body.appendChild(s)
      }
      if (busy) { const t = document.createElement('div'); t.className = 'typing'; t.textContent = '\u2026'; body.appendChild(t) }
      body.scrollTop = body.scrollHeight
    }

    async function send(q) {
      const content = (q ?? input.value).trim(); if (!content || busy) return
      input.value = ''; busy = true; msgs.push({ role: 'user', content }); paint()
      try {
        const r = await api({ mode: 'message', client_slug: slug, conversation_id: convId, content, channel: 'web', page_url: location.href, origin: location.hostname, lead: leadDone ? lead : undefined })
        if (r.conversation_id && r.conversation_id !== convId) { convId = r.conversation_id; sessionStorage.setItem(storeKey, convId); startPolling() }
        msgs.push({ role: r.role || 'assistant', content: r.content, id: r.message_id })
        if (r.message_id) lastId = r.message_id
        if (cfg.widget?.lead_capture === 'after' && !leadDone && msgs.filter((m) => m.role === 'user').length === 1) { busy = false; return showLead(() => { paint() }) }
      } catch (e) { msgs.push({ role: 'assistant', content: `Si \u00E8 verificato un errore: ${e.message}` }) }
      busy = false; paint()
    }
    form.onsubmit = (e) => { e.preventDefault(); send() }

    function startPolling() {
      // Picks up operator (human) replies and bot messages sent from other channels.
      clearInterval(pollTimer)
      pollTimer = setInterval(async () => {
        if (!convId) return
        try {
          const r = await api({ mode: 'poll', conversation_id: convId, after_id: lastId })
          const fresh = (r.messages || []).filter((m) => !msgs.some((x) => x.id === m.id))
          if (fresh.length) { msgs.push(...fresh); lastId = fresh[fresh.length - 1].id; paint() }
        } catch {}
      }, 4000)
    }
    if (convId) startPolling()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init()
})()
