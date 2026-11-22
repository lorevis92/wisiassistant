import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { makeApi, mountChat, normalizeWidget } from '../../widget/chat-ui.js'
import { applyTheme, getThemePref, setThemePref, THEME_KEY } from '../lib/theme'

const storedPref = () => { try { return localStorage.getItem(THEME_KEY) } catch { return null } }

/**
 * Public standalone chat page: /c/:slug — no login. Same UI and behaviour as the site widget
 * (shared widget/chat-ui.js), full page, without launcher or preview bubble.
 * Theme: the visitor's own choice (chat menu → Tema, remembered) or else the client's widget theme; the chat follows it.
 */
export default function Standalone() {
  const { slug } = useParams()
  const ref = useRef(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    let inst = null
    const api = makeApi(`${FUNCTIONS_URL}/chat`, SUPABASE_ANON_KEY)
    setState('loading')
    api({ mode: 'config', client_slug: slug, channel: 'standalone' })
      .then((cfg) => {
        if (!alive || !ref.current) return
        const w = normalizeWidget(cfg.widget)
        document.title = `${w.title} · ${cfg.name}`
        let pref = storedPref() || w.theme
        applyTheme(pref)
        const themeMenu = { get: () => pref, set: (p) => { pref = p; setThemePref(p) } }
        inst = mountChat(ref.current, { cfg, api, slug, mode: 'page', channel: 'standalone', themeMenu })
        setState('ready')
      })
      .catch((e) => { if (alive) { setErr(e.message); setState('error') } })
    return () => { alive = false; inst?.destroy(); applyTheme(getThemePref()) }
  }, [slug])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface)' }}>
      <div ref={ref} style={{ height: '100%' }} />
      {state !== 'ready' && (
        <div role="status" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--textMuted)', padding: 24, textAlign: 'center' }}>
          {state === 'error' ? <>Questa chat al momento non è disponibile.<span className="small">{err}</span></> : <span className="spinner" aria-label="Caricamento" />}
        </div>
      )}
    </div>
  )
}
