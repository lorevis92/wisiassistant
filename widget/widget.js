/**
 * WISI Assistant embeddable widget.
 * Usage on the client's site:
 *   <script src="https://YOUR-DOMAIN/widget.js" data-client="CLIENT_SLUG" async></script>
 * Optional: data-supabase-url / data-anon-key override the values baked in at build time.
 *
 * The UI (launcher, preview bubble, panel) lives in ./chat-ui.js and is shared with the standalone page
 * and the admin live preview. It runs inside a Shadow DOM, isolated from the host site's CSS.
 */
import { makeApi, mountChat } from './chat-ui.js'

;(function () {
  if (window.__wisiAssistantLoaded) return
  window.__wisiAssistantLoaded = true

  const script = document.currentScript || Array.from(document.scripts).find((s) => (s.src || '').includes('widget.js'))
  const slug = script?.dataset.client
  if (!slug) return console.warn('[WISI Assistant] data-client mancante')

  const SUPABASE_URL = script.dataset.supabaseUrl || __WA_SUPABASE_URL__
  const ANON = script.dataset.anonKey || __WA_ANON_KEY__
  const api = makeApi(`${SUPABASE_URL}/functions/v1/chat`, ANON)

  async function init() {
    let cfg
    try { cfg = await api({ mode: 'config', client_slug: slug, channel: 'web', origin: location.hostname }) } catch (e) { return console.warn('[WISI Assistant]', e.message) }
    const host = document.createElement('div')
    host.id = 'wisi-assistant-root'
    document.body.appendChild(host)
    mountChat(host, { cfg, api, slug, mode: 'widget', channel: 'web' })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init()
})()
