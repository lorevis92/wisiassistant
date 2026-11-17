/**
 * WISI Assistant chat UI (vanilla JS, Shadow DOM). One implementation, three uses:
 *  - mode 'widget'  → launcher + preview bubble + floating panel on the client's site (widget/widget.js)
 *  - mode 'page'    → full-page chat, no launcher / preview bubble (src/pages/Standalone.jsx, /c/:slug)
 *  - mode 'preview' → live preview in the admin panel (no storage, fake API), preview: 'open' | 'closed'
 *
 * All appearance values come from the public config returned by the `chat` edge function (mode 'config'):
 * cfg.widget = { title, welcome, suggestions[], color, position, avatar{}, header_avatar{}|null, bot_avatar, teaser_text, teaser_delay,
 *               disclaimer, lead_capture }  (see widget/avatars.js for the avatar fallbacks)
 */
import { avatarMarkup, resolveAvatar, resolveHeaderAvatar, safeColor } from './avatars.js'

export const DEFAULT_DISCLAIMER = 'Le informazioni potrebbero non essere del tutto accurate. Per questioni importanti contatta direttamente la struttura.'
export const DEFAULT_WIDGET = {
  title: 'Assistente',
  welcome: 'Ciao! Come posso aiutarti?',
  color: '#E8352A',
  position: 'right',
  suggestions: [],
  teaser_text: 'Ciao! Hai bisogno di aiuto?',
  teaser_delay: 0,
  disclaimer: DEFAULT_DISCLAIMER,
  lead_capture: 'off',
}

/** Normalized, safe widget settings (defaults for missing values; an explicitly empty disclaimer hides it). */
export function normalizeWidget(raw) {
  const w = { ...DEFAULT_WIDGET, ...(raw || {}) }
  const sug = Array.isArray(w.suggestions) ? w.suggestions : String(w.suggestions || '').split('\n')
  return {
    title: String(w.title || DEFAULT_WIDGET.title).slice(0, 80),
    welcome: String(w.welcome || DEFAULT_WIDGET.welcome),
    color: safeColor(w.color, DEFAULT_WIDGET.color),
    position: w.position === 'left' ? 'left' : 'right',
    suggestions: sug.map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
    teaser_text: String(w.teaser_text ?? '').trim().slice(0, 160),
    teaser_delay: Math.max(0, Math.min(600, Number(w.teaser_delay) || 0)),
    disclaimer: raw && raw.disclaimer !== undefined && raw.disclaimer !== null ? String(raw.disclaimer).trim() : DEFAULT_DISCLAIMER,
    lead_capture: ['before', 'after'].includes(w.lead_capture) ? w.lead_capture : 'off',
    avatar: resolveAvatar(w),              // launcher (chat closed)
    headerAvatar: resolveHeaderAvatar(w),  // header + bot messages (chat open)
    botAvatar: w.bot_avatar === true,
  }
}

export function makeApi(url, anonKey) {
  return async (body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j.error || 'Errore'), { status: r.status })
    return j
  }
}

// ------------------------------------------------------------------ helpers
const storage = (kind) => ({
  get(k) { try { return window[kind].getItem(k) } catch { return null } },
  set(k, v) { try { window[kind].setItem(k, v) } catch { /* blocked / full / private mode */ } },
  del(k) { try { window[kind].removeItem(k) } catch { /* ignore */ } },
})
const noStore = { get: () => null, set() {}, del() {} }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function renderText(t) {
  let out = esc(t)
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, a, u) => `<a href="${u}" target="_blank" rel="noopener">${a}</a>`)
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  return out.replace(/\n/g, '<br>')
}

/** Splits text into atoms that are always rendered whole: markdown links, bold spans, URLs, words (+ trailing spaces). */
const ATOM = /\[[^\]\n]*\]\([^)\s]*\)|\*\*[^*\n]+?\*\*|https?:\/\/[^\s<)]+/y
export function tokenize(t) {
  const out = []
  let i = 0
  while (i < t.length) {
    ATOM.lastIndex = i
    const m = ATOM.exec(t)
    let j
    if (m) j = i + m[0].length
    else {
      j = i + 1
      while (j < t.length && !/[\s[*]/.test(t[j]) && !t.startsWith('http', j)) j++
    }
    while (j < t.length && /\s/.test(t[j])) j++
    out.push(t.slice(i, j))
    i = j
  }
  return out
}

function luminance(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ensureFont() {
  // @font-face inside a shadow root is ignored by some browsers: the font stylesheet goes in the page <head>
  if (document.getElementById('wa-inter-font')) return
  const l = document.createElement('link')
  l.id = 'wa-inter-font'; l.rel = 'stylesheet'
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'
  document.head.appendChild(l)
}

const ICON = {
  chevron: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  closeSm: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  up: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm0 0l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 18.2 21H7"/></svg>',
  down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zm0 0l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.3-8A2 2 0 0 1 5.8 3H17"/></svg>',
}

function styles(w, mode) {
  const side = w.position === 'left' ? 'left' : 'right'
  const other = side === 'left' ? 'right' : 'left'
  const on = luminance(w.color) > 0.55 ? '#1f2328' : '#ffffff'
  const link = luminance(w.color) < 0.45 ? w.color : '#1f2328'
  return `
:host{all:initial;${mode === 'widget' ? '' : 'display:block;height:100%;'}}
.wa{--c:${w.color};--on:${on};--link:${link};--pos:${mode === 'widget' ? 'fixed' : 'absolute'};--ink:#1f2328;--muted:#8b949e;--soft:#f2f3f5;--line:#e6e8eb;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:400;line-height:1.5;color:var(--ink);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-align:left;${mode === 'widget' ? '' : 'position:relative;height:100%;'}}
:where(.wa) *,:where(.wa) *::before,:where(.wa) *::after{box-sizing:border-box;font-family:inherit;letter-spacing:normal}
:where(.wa) button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.wa button:focus-visible{outline:2px solid var(--c);outline-offset:2px}
[hidden]{display:none!important}

/* launcher */
.launcher{position:var(--pos);bottom:20px;${side}:20px;width:60px;height:60px;border-radius:50%;border:3px solid #fff;background:#fff;overflow:hidden;
  box-shadow:0 6px 22px rgba(15,20,30,.22),0 1px 3px rgba(15,20,30,.12);z-index:2147483000;transition:transform .2s ease}
.launcher:hover{transform:scale(1.05)}
.launcher:active{transform:scale(.97)}
.l-face,.l-close{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:opacity .2s ease,transform .25s ease}
.l-close{background:#1f2328;color:#fff;opacity:0;transform:rotate(-90deg)}
.is-open .l-close{opacity:1;transform:none}
.is-open .l-face{opacity:0;transform:scale(.8)}
.l-face svg,.avatar svg,.avatar-img{width:100%;height:100%;display:block;object-fit:cover}
.row.bot.with-av{flex-direction:row;align-items:flex-end;gap:8px;max-width:92%}
.row.bot.with-av .stack{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.mini-av{width:26px;height:26px;border-radius:50%;overflow:hidden;flex:none;background:var(--soft);margin-bottom:2px}
.row.bot.with-av.has-fb .mini-av{margin-bottom:30px}

/* preview bubble */
.teaser{position:var(--pos);bottom:28px;${side}:92px;max-width:min(260px,calc(100% - 120px));z-index:2147483000;animation:wa-pop .28s ease both}
.mode-widget .teaser{max-width:min(260px,calc(100vw - 120px))}
.teaser-msg{display:block;width:100%;text-align:left;background:#fff;color:var(--ink);border-radius:18px;padding:11px 15px;font-size:14px;line-height:1.45;
  box-shadow:0 6px 24px rgba(15,20,30,.16),0 1px 2px rgba(15,20,30,.08)}
.teaser-x{position:absolute;top:-9px;${other}:-9px;width:22px;height:22px;border-radius:50%;background:#fff;color:#57606a;display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 5px rgba(15,20,30,.22);opacity:0;transition:opacity .15s}
.teaser:hover .teaser-x,.teaser:focus-within .teaser-x{opacity:1}
@media (hover:none){.teaser-x{opacity:1}}

/* panel */
.panel{position:var(--pos);bottom:92px;${side}:20px;width:380px;max-width:calc(100% - 40px);height:min(640px,calc(100vh - 116px));height:min(640px,calc(100dvh - 116px));
  background:#fff;border-radius:18px;box-shadow:0 12px 48px rgba(15,20,30,.18),0 2px 8px rgba(15,20,30,.08);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;
  opacity:0;visibility:hidden;transform:translateY(14px) scale(.98);transform-origin:bottom ${side};pointer-events:none;
  transition:opacity .2s ease,transform .22s ease,visibility 0s linear .22s}
.mode-widget .panel{max-width:calc(100vw - 40px)}
.is-open .panel{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .2s ease,transform .22s ease,visibility 0s}
.mode-preview .panel{height:calc(100% - 112px);max-height:640px}

.head{display:flex;align-items:center;gap:10px;padding:12px 10px 12px 14px;border-bottom:1px solid var(--line);background:#fff;flex:none}
.head .avatar{width:34px;height:34px;border-radius:50%;overflow:hidden;flex:none;background:var(--soft)}
.head .name{flex:1;min-width:0;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#57606a;flex:none;transition:background .15s,color .15s}
.icon:hover{background:#f3f4f6;color:var(--ink)}
.menu-wrap{position:relative}
.menu{position:absolute;top:38px;right:0;min-width:176px;background:#fff;border-radius:12px;padding:6px;z-index:3;
  box-shadow:0 10px 30px rgba(15,20,30,.16),0 0 0 1px rgba(15,20,30,.06);animation:wa-pop .15s ease both}
.menu button{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:8px;font-size:14px}
.menu button:hover:not(:disabled),.menu button:focus-visible{background:#f3f4f6;outline:none}
.menu button:disabled{color:#a7adb5;cursor:default}

.body{flex:1;overflow-y:auto;padding:18px 14px 8px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain;scrollbar-width:thin}
.row{display:flex;flex-direction:column;max-width:86%}
.row.user{align-self:flex-end;align-items:flex-end}
.row.bot{align-self:flex-start;align-items:flex-start}
.who{font-size:11.5px;font-weight:500;color:var(--muted);margin:0 6px 3px}
.bubble{padding:9px 14px;border-radius:18px;font-size:14.5px;line-height:1.5;overflow-wrap:anywhere;word-break:normal}
.row.bot .bubble{background:var(--soft);color:var(--ink);border-bottom-left-radius:6px}
.row.user .bubble{background:var(--c);color:var(--on);border-bottom-right-radius:6px}
.bubble a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.row.bot .bubble a{color:var(--link)}
.bubble strong{font-weight:600}
.row.fresh{animation:wa-in .22s ease both}
.fb{display:flex;gap:2px;margin:2px 2px 0;opacity:0;transition:opacity .15s}
.row:hover .fb,.fb:focus-within{opacity:1}
@media (hover:none){.fb{opacity:.65}}
.fb button{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--muted)}
.fb button:hover{background:#f3f4f6;color:var(--ink)}
.fb button.on{color:var(--c)}
.sug{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.sug button{padding:7px 13px;border-radius:999px;border:1px solid var(--line);background:#fff;font-size:13.5px;line-height:1.35;color:var(--ink);text-align:left;transition:border-color .15s,background .15s}
.sug button:hover{border-color:var(--c);background:#fafbfc}
.typing{display:inline-flex;align-items:center;gap:4px;padding:14px 15px}
.typing i{width:7px;height:7px;border-radius:50%;background:#9aa1a9;animation:wa-dot 1.2s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}

.lead{align-self:stretch;background:#f7f8fa;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:8px;animation:wa-in .22s ease both}
.lead p{margin:0 0 2px;font-weight:500;font-size:14px}
.lead label{font-size:12.5px;font-weight:500;color:#57606a;margin-top:2px}
.lead input{width:100%;border:1px solid var(--line);border-radius:999px;padding:9px 14px;font:inherit;font-size:14px;color:var(--ink);background:#fff;outline:0;transition:border-color .15s}
.lead input:focus{border-color:var(--c)}
.lead .primary{margin-top:6px;background:var(--c);color:var(--on);border-radius:999px;padding:10px 14px;font-weight:600;font-size:14px}

.composer{padding:8px 12px 4px;flex:none}
.pill{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:5px 5px 5px 16px;background:#fff;transition:border-color .15s,box-shadow .15s}
.pill:focus-within{border-color:#c9ced4;box-shadow:0 0 0 3px rgba(15,20,30,.04)}
.pill input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:14.5px;color:var(--ink);padding:6px 0}
.pill input::placeholder{color:var(--muted)}
.pill input:disabled{cursor:not-allowed}
.mic-slot{width:34px;height:34px;flex:none}
.send{width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:#eceef1;color:#a7adb5;transition:background .15s,color .15s,transform .15s}
.send:not(:disabled){background:var(--c);color:var(--on)}
.send:not(:disabled):active{transform:scale(.94)}
.send:disabled{cursor:default}
.disclaimer{font-size:11px;line-height:1.4;color:var(--muted);text-align:center;padding:4px 20px 11px;flex:none}

/* full page */
.mode-page .panel{position:relative;inset:auto;width:100%;max-width:none;height:100%;border-radius:0;box-shadow:none;opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:none}
.mode-page .head{padding:12px max(12px,calc(50% - 380px))}
.mode-page .body,.mode-page .composer,.mode-page .disclaimer{width:100%;max-width:760px;margin-left:auto;margin-right:auto}
.mode-page .body{padding-top:24px}

@media (max-width:520px){
  .mode-widget .panel{left:8px;right:8px;top:8px;bottom:84px;width:auto;max-width:none;height:auto;border-radius:16px}
  .mode-widget .launcher{bottom:14px;${side}:14px}
  .mode-widget .teaser{bottom:22px;${side}:84px}
}
@keyframes wa-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes wa-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes wa-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.wa *{animation:none!important;transition:none!important}}
`
}

// ------------------------------------------------------------------ mount
export function mountChat(host, opts) {
  const { cfg, api, slug, mode = 'widget', channel = 'web', preview = 'open' } = opts
  const w = normalizeWidget(cfg.widget)
  const isWidget = mode === 'widget', isPage = mode === 'page', isPreview = mode === 'preview'
  const session = isPreview ? noStore : storage('sessionStorage')
  const local = isPreview ? noStore : storage('localStorage')
  const convKey = `wa-conv-${slug}`
  const teaserKey = `wa-teaser-off-${slug}`
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  ensureFont()
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const launcherAv = avatarMarkup(w.avatar)
  const headerAv = avatarMarkup(w.headerAvatar)
  const panelId = `wa-panel-${Math.random().toString(36).slice(2, 8)}`
  shadow.innerHTML = `<style>${styles(w, mode)}</style>
<div class="wa mode-${mode}">
  ${isPage ? '' : `
  <div class="teaser" hidden>
    <button class="teaser-msg" type="button">${esc(w.teaser_text)}</button>
    <button class="teaser-x" type="button" aria-label="Chiudi il messaggio">${ICON.closeSm}</button>
  </div>
  <button class="launcher" type="button" aria-label="Apri la chat" aria-expanded="false" aria-controls="${panelId}">
    <span class="l-face">${launcherAv}</span><span class="l-close">${ICON.chevron}</span>
  </button>`}
  <section class="panel" id="${panelId}" tabindex="-1" role="dialog" aria-label="Chat con ${esc(w.title)}" ${isPage ? '' : 'aria-hidden="true"'}>
    <header class="head">
      <span class="avatar">${headerAv}</span>
      <div class="name">${esc(w.title)}</div>
      <div class="menu-wrap">
        <button class="icon menu-btn" type="button" aria-label="Altre opzioni" aria-haspopup="menu" aria-expanded="false">${ICON.dots}</button>
        <div class="menu" role="menu" hidden>
          <button type="button" role="menuitem" data-act="new">Nuova chat</button>
          <button type="button" role="menuitem" data-act="end">Termina chat</button>
        </div>
      </div>
      ${isPage ? '' : `<button class="icon close" type="button" aria-label="Chiudi la chat">${ICON.close}</button>`}
    </header>
    <div class="body" role="log" aria-live="polite" aria-label="Messaggi"></div>
    <form class="composer" novalidate>
      <div class="pill">
        <input type="text" aria-label="Scrivi un messaggio" placeholder="Scrivi un messaggio…" autocomplete="off" maxlength="2000">
        <span class="mic-slot" hidden></span>
        <button class="send" type="submit" aria-label="Invia il messaggio" disabled>${ICON.send}</button>
      </div>
    </form>
    ${w.disclaimer ? `<div class="disclaimer">${esc(w.disclaimer)}</div>` : ''}
  </section>
</div>`

  const $ = (s) => shadow.querySelector(s)
  const root = $('.wa'), body = $('.body'), form = $('.composer'), input = $('.pill input'), sendBtn = $('.send')
  const launcher = $('.launcher'), panel = $('.panel'), teaser = $('.teaser'), menuBtn = $('.menu-btn'), menu = $('.menu')
  const endItem = menu.querySelector('[data-act="end"]')

  const st = { open: false, convId: session.get(convKey), msgs: [], busy: false, leadDone: false, lead: {}, leadForm: null, started: false, epoch: 0 }
  let pollTimer = null, teaserTimer = null, streamTimer = null, lastId = null
  const cleanups = []
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); cleanups.push(() => el.removeEventListener(ev, fn, o)) }

  const welcome = () => ({ role: 'assistant', content: w.welcome })

  // ---------------------------------------------------------------- open / close
  function setOpen(v, { focus = true } = {}) {
    if (isPage) return
    st.open = v
    root.classList.toggle('is-open', v)
    launcher.setAttribute('aria-expanded', String(v))
    launcher.setAttribute('aria-label', v ? 'Chiudi la chat' : 'Apri la chat')
    panel.setAttribute('aria-hidden', String(!v))
    closeMenu()
    if (v) {
      hideTeaser()
      if (!st.started) start()
      if (focus) setTimeout(() => (input.disabled ? body.querySelector('.lead input') || panel : input).focus({ preventScroll: true }), 60)
    } else if (focus && shadow.activeElement && panel.contains(shadow.activeElement)) launcher.focus()
  }

  // ---------------------------------------------------------------- preview bubble (teaser)
  function showTeaser() { if (teaser && !st.open && w.teaser_text) teaser.hidden = false }
  function hideTeaser() { if (teaser) teaser.hidden = true; clearTimeout(teaserTimer) }
  if (teaser && w.teaser_text && w.teaser_delay > 0) {
    if (isPreview) { if (preview === 'closed') showTeaser() }
    else if (!local.get(teaserKey)) teaserTimer = setTimeout(showTeaser, w.teaser_delay * 1000)
  }

  // ---------------------------------------------------------------- menu
  function openMenu() { endItem.disabled = !st.convId; menu.hidden = false; menuBtn.setAttribute('aria-expanded', 'true'); (menu.querySelector('button:not(:disabled)') || menuBtn).focus() }
  function closeMenu() { if (!menu.hidden) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false') } }

  // ---------------------------------------------------------------- conversation
  function resetConv() {
    st.epoch++
    st.convId = null; lastId = null; clearInterval(pollTimer); clearInterval(streamTimer)
    session.del(convKey)
  }

  function restart() {
    resetConv()
    st.busy = false; st.msgs = [welcome()]; st.leadForm = null
    paint(); updateComposer(); input.value = ''; updateSend()
    if (!isPage || st.open) input.focus({ preventScroll: true })
  }

  async function start() {
    st.started = true
    if (st.convId && !isPreview) {
      // saved conversation (page reloaded): show the full transcript and poll from its last message
      st.busy = true; paint()
      const epoch = st.epoch
      try {
        const h = await api({ mode: 'history', client_slug: slug, conversation_id: st.convId })
        if (epoch !== st.epoch) return
        const hist = h.messages || []
        st.msgs = [welcome(), ...hist]
        lastId = hist.length ? hist[hist.length - 1].id : null
        st.leadDone = true; st.busy = false
        paint(); updateComposer(); startPolling()
        return
      } catch { if (epoch !== st.epoch) return; resetConv() }
      st.busy = false
    }
    if (w.lead_capture === 'before' && !st.leadDone) {
      st.leadForm = { intro: 'Prima di iniziare, lasciaci i tuoi dati così possiamo ricontattarti se serve.', done: () => { st.msgs.push(welcome()) } }
    } else st.msgs.push(welcome())
    paint(); updateComposer()
  }

  async function send(text) {
    const content = String(text ?? input.value).trim()
    if (!content || st.busy || st.leadForm) return
    input.value = ''; updateSend()
    st.busy = true
    st.msgs.push({ role: 'user', content, fresh: true })
    paint()
    const epoch = st.epoch
    try {
      const r = await api({ mode: 'message', client_slug: slug, conversation_id: st.convId, content, channel, page_url: location.href, origin: location.hostname, lead: st.leadDone ? st.lead : undefined })
      if (epoch !== st.epoch) return
      if (r.conversation_id && r.conversation_id !== st.convId) {
        st.convId = r.conversation_id; lastId = r.message_id || null
        session.set(convKey, st.convId); startPolling()
      }
      const m = { role: r.role || 'assistant', content: r.content || '', id: r.message_id, fresh: true }
      st.busy = false
      st.msgs.push(m)
      if (w.lead_capture === 'after' && !st.leadDone && st.msgs.filter((x) => x.role === 'user').length === 1) {
        st.leadForm = { intro: 'Vuoi lasciarci i tuoi dati? Così possiamo ricontattarti se serve.', done: () => {} }
      }
      stream(m)
    } catch (e) {
      if (epoch !== st.epoch) return
      st.busy = false
      st.msgs.push({ role: 'assistant', content: `Si è verificato un errore: ${e.message}`, fresh: true })
      paint()
    }
    updateComposer()
  }

  /** Reveals a reply quickly in whole atoms (words, links, bold spans): ~2 s for a long text, never broken markdown. */
  function stream(m) {
    const tokens = tokenize(m.content)
    if (reduceMotion || tokens.length < 4) { paint(); return }
    m.shown = 0; m.tokens = tokens
    paint()
    const total = Math.min(2000, Math.max(300, tokens.length * 26))
    const perTick = Math.max(1, Math.ceil(tokens.length / (total / 30)))
    clearInterval(streamTimer)
    streamTimer = setInterval(() => {
      m.shown = Math.min(tokens.length, m.shown + perTick)
      const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80
      if (m.el) m.el.innerHTML = renderText(tokens.slice(0, m.shown).join(''))
      if (nearBottom) body.scrollTop = body.scrollHeight
      if (m.shown >= tokens.length) { clearInterval(streamTimer); delete m.tokens; delete m.shown; paint() }
    }, 30)
  }

  function paint() {
    body.innerHTML = ''
    for (const m of st.msgs) {
      const row = document.createElement('div')
      const bot = m.role !== 'user'
      row.className = `row ${bot ? 'bot' : 'user'}${m.fresh ? ' fresh' : ''}`
      m.fresh = false
      // optional profile image next to the assistant's messages (not next to operator replies)
      let wrap = row
      if (bot && w.botAvatar && m.role === 'assistant') {
        row.classList.add('with-av')
        row.insertAdjacentHTML('beforeend', `<span class="mini-av" aria-hidden="true">${headerAv}</span>`)
        wrap = document.createElement('div'); wrap.className = 'stack'; row.appendChild(wrap)
      }
      if (m.role === 'human') wrap.insertAdjacentHTML('beforeend', '<div class="who">Operatore</div>')
      const b = document.createElement('div')
      b.className = 'bubble'
      b.innerHTML = renderText(m.tokens ? m.tokens.slice(0, m.shown).join('') : m.content)
      m.el = b
      wrap.appendChild(b)
      if (m.role === 'assistant' && m.id && !m.tokens) {
        const fb = document.createElement('div')
        fb.className = 'fb'
        fb.innerHTML = `<button type="button" data-v="1" aria-label="Risposta utile" aria-pressed="${m.feedback === 1}" class="${m.feedback === 1 ? 'on' : ''}">${ICON.up}</button>` +
          `<button type="button" data-v="-1" aria-label="Risposta non utile" aria-pressed="${m.feedback === -1}" class="${m.feedback === -1 ? 'on' : ''}">${ICON.down}</button>`
        fb.querySelectorAll('button').forEach((btn) => (btn.onclick = async () => {
          m.feedback = Number(btn.dataset.v); paint()
          try { await api({ mode: 'feedback', message_id: m.id, value: m.feedback }) } catch { /* ignore */ }
        }))
        wrap.appendChild(fb)
        row.classList.add('has-fb')
      }
      body.appendChild(row)
    }
    if (st.msgs.length === 1 && !st.busy && !st.leadForm && w.suggestions.length) {
      const s = document.createElement('div'); s.className = 'sug'
      for (const q of w.suggestions) { const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.onclick = () => send(q); s.appendChild(b) }
      body.appendChild(s)
    }
    if (st.leadForm) body.appendChild(leadCard())
    if (st.busy) {
      const av = w.botAvatar ? `<span class="mini-av" aria-hidden="true">${headerAv}</span>` : ''
      body.insertAdjacentHTML('beforeend', `<div class="row bot fresh${w.botAvatar ? ' with-av' : ''}" aria-label="L’assistente sta scrivendo">${av}<div class="bubble typing"><i></i><i></i><i></i></div></div>`)
    }
    body.scrollTop = body.scrollHeight
  }

  function leadCard() {
    const f = document.createElement('form')
    f.className = 'lead'
    f.innerHTML = `<p>${esc(st.leadForm.intro)}</p>
      <label for="wa-lead-name">Nome</label><input id="wa-lead-name" name="name" autocomplete="name" required>
      <label for="wa-lead-email">Email</label><input id="wa-lead-email" name="email" type="email" autocomplete="email" required>
      <button class="primary" type="submit">${st.msgs.length ? 'Continua' : 'Inizia la chat'}</button>`
    f.onsubmit = (e) => {
      e.preventDefault()
      if (!f.reportValidity()) return
      const fd = new FormData(f)
      st.lead = { name: String(fd.get('name') || '').trim(), email: String(fd.get('email') || '').trim() }
      st.leadDone = true
      const done = st.leadForm.done
      st.leadForm = null
      done()
      paint(); updateComposer(); input.focus({ preventScroll: true })
    }
    return f
  }

  function updateComposer() {
    input.disabled = !!st.leadForm
    input.placeholder = st.leadForm ? 'Compila il modulo per continuare' : 'Scrivi un messaggio…'
    updateSend()
  }
  function updateSend() { sendBtn.disabled = !input.value.trim() || st.busy || !!st.leadForm }

  function startPolling() {
    // Picks up operator (human) replies after the cursor (the server never returns bot replies here).
    clearInterval(pollTimer)
    if (isPreview) return
    pollTimer = setInterval(async () => {
      const id = st.convId
      if (!id) return
      try {
        const r = await api({ mode: 'poll', client_slug: slug, conversation_id: id, after_id: lastId })
        if (id !== st.convId) return
        const got = r.messages || []
        if (got.length) lastId = got[got.length - 1].id
        else if (!lastId && r.cursor) lastId = r.cursor
        const fresh = got.filter((m) => !st.msgs.some((x) => x.id === m.id)).map((m) => ({ ...m, fresh: true }))
        if (fresh.length) { st.msgs.push(...fresh); paint() }
      } catch (e) { if (e.status === 404 && id === st.convId) resetConv() }
    }, 4000)
  }

  // ---------------------------------------------------------------- events
  if (launcher) on(launcher, 'click', () => setOpen(!st.open))
  const closeBtn = $('.close')
  if (closeBtn) on(closeBtn, 'click', () => setOpen(false))
  if (teaser) {
    on($('.teaser-msg'), 'click', () => setOpen(true))
    on($('.teaser-x'), 'click', (e) => { e.stopPropagation(); hideTeaser(); local.set(teaserKey, '1') })
  }
  on(menuBtn, 'click', (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu() })
  on(menu, 'click', (e) => {
    const act = e.target.closest('button')?.dataset.act
    if (!act) return
    closeMenu()
    if (act === 'end') {
      if (!st.convId) return
      const id = st.convId
      api({ mode: 'end', client_slug: slug, conversation_id: id }).catch(() => {})
    }
    restart()
  })
  on(shadow, 'click', (e) => { if (!menu.hidden && !e.composedPath().includes(menu) && !e.composedPath().includes(menuBtn)) closeMenu() })
  on(document, 'click', (e) => { if (!menu.hidden && !e.composedPath().includes(host)) closeMenu() })
  on(document, 'keydown', (e) => {
    if (e.key !== 'Escape') return
    if (!menu.hidden) { closeMenu(); menuBtn.focus(); return }
    if (st.open && !isPage && (isWidget || host.contains(e.target) || e.composedPath().includes(host))) setOpen(false)
  })
  on(input, 'input', updateSend)
  on(form, 'submit', (e) => { e.preventDefault(); send() })

  // ---------------------------------------------------------------- initial state
  if (isPage) { st.open = true; start(); setTimeout(() => input.focus({ preventScroll: true }), 60) }
  else if (isPreview && preview === 'open') setOpen(true, { focus: false })

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    destroy() {
      st.epoch++
      clearInterval(pollTimer); clearInterval(streamTimer); clearTimeout(teaserTimer)
      cleanups.forEach((f) => f())
      shadow.innerHTML = ''
    },
  }
}
