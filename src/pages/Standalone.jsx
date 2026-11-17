import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { makeApi, mountChat, normalizeWidget } from '../../widget/chat-ui.js'

/**
 * Public standalone chat page: /c/:slug — no login. Same UI and behaviour as the site widget
 * (shared widget/chat-ui.js), full page, without launcher or preview bubble.
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
        document.title = `${normalizeWidget(cfg.widget).title} · ${cfg.name}`
        inst = mountChat(ref.current, { cfg, api, slug, mode: 'page', channel: 'standalone' })
        setState('ready')
      })
      .catch((e) => { if (alive) { setErr(e.message); setState('error') } })
    return () => { alive = false; inst?.destroy() }
  }, [slug])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff' }}>
      <div ref={ref} style={{ height: '100%' }} />
      {state !== 'ready' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, color: '#8b949e' }}>
          {state === 'error' ? `Assistente non disponibile (${err})` : 'Caricamento…'}
        </div>
      )}
    </div>
  )
}
