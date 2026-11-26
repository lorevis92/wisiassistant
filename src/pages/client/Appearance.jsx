import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/ui'
import { AVATAR_PRESETS, DEFAULT_AVATAR, avatarMarkup, presetSvg, resolveAvatar } from '../../../widget/avatars.js'
import { DEFAULT_DISCLAIMER, mountChat } from '../../../widget/chat-ui.js'

const BUCKET = 'wa-avatars'
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_SOURCE_MB = 10 // original file chosen by the admin (it is cropped + resized before upload)
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // bucket limit (migration 0004)
const PREVIEW_REPLY = 'Questa è un’anteprima: qui comparirà la risposta dell’assistente, con i **dettagli importanti** in evidenza e i link alle pagine del sito, ad esempio [Camere e suite](https://example.com/camere).'

/**
 * "Aspetto" section of the client settings: launcher image, header (profile) image, name, texts, colour, position,
 * preview bubble, disclaimer, light / dark / auto theme, with a live preview rendered by the same code as the real widget (widget/chat-ui.js).
 * Values live in clients.widget (avatar, header_avatar, bot_avatar, …) and reach the widget through the public
 * config of the `chat` function.
 */
export default function Appearance({ client, widget, setWidget, setToast }) {
  const launcher = resolveAvatar(widget)
  const header = widget.header_avatar && typeof widget.header_avatar === 'object' ? widget.header_avatar : null
  const suggestions = Array.isArray(widget.suggestions) ? widget.suggestions.join('\n') : widget.suggestions || ''

  return (
    <div className="card">
      <div className="card-title">Aspetto</div>
      <p className="card-sub">Come appare l’assistente sul sito del cliente e nella pagina chat. Le modifiche si vedono subito nell’anteprima; ricorda di salvare.</p>
      <div className="appearance-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 24, alignItems: 'start' }}>
        <div className="col" style={{ gap: 0 }}>
          <div className="field">
            <label className="label">Immagine del pallino</label>
            <AvatarPicker slot="launcher" client={client} setToast={setToast} value={launcher}
              onChange={(a) => setWidget({ avatar: a })} onRemove={() => setWidget({ avatar: { ...launcher, kind: 'preset', url: '' } })} />
            <div className="hint">Visibile a chat chiusa, in basso sul sito.</div>
          </div>

          <div className="field">
            <label className="label">Immagine intestazione (profilo)</label>
            <AvatarPicker slot="header" client={client} setToast={setToast} value={header} inherit={launcher}
              onChange={(a) => setWidget({ header_avatar: a })} onRemove={() => setWidget({ header_avatar: null })} />
            <label className="row small" style={{ gap: 8, marginTop: 10, cursor: 'pointer' }}>
              <input type="checkbox" className="checkbox" checked={widget.bot_avatar === true} onChange={(e) => setWidget({ bot_avatar: e.target.checked })} />
              Mostrala anche accanto ai messaggi dell’assistente
            </label>
            <div className="hint">Visibile a chat aperta, accanto al nome. Se non la imposti si usa l’immagine del pallino.</div>
          </div>
          <div className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
            Formati PNG, JPG, WebP o GIF fino a {MAX_SOURCE_MB} MB: le immagini vengono ritagliate quadrate e ridimensionate a 256 px prima del caricamento.
          </div>

          <div className="grid2">
            <div className="field"><label className="label">Nome dell’assistente</label>
              <input className="input" value={widget.title || ''} onChange={(e) => setWidget({ title: e.target.value })} maxLength={80} /></div>
            <div className="field"><label className="label">Colore principale</label>
              <ColorField value={widget.color} onChange={(v) => setWidget({ color: v })} /></div>
          </div>
          <div className="field"><label className="label" id="wa-theme-label">Tema</label>
            <div className="tabs" role="radiogroup" aria-labelledby="wa-theme-label">
              {[['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={(widget.theme || 'auto') === k} className={`tab ${(widget.theme || 'auto') === k ? 'active' : ''}`} onClick={() => setWidget({ theme: k })}>{l}</button>
              ))}
            </div>
            <div className="hint">Automatico segue il sito che ospita il widget: chiaro su un sito chiaro, scuro su un sito scuro. Nella pagina chat il visitatore può cambiarlo dal menu.</div></div>
          <div className="field"><label className="label">Messaggio di benvenuto</label>
            <textarea className="textarea" style={{ minHeight: 60 }} value={widget.welcome || ''} onChange={(e) => setWidget({ welcome: e.target.value })} /></div>
          <div className="field"><label className="label">Domande suggerite (una per riga)</label>
            <textarea className="textarea" style={{ minHeight: 70 }} value={suggestions} onChange={(e) => setWidget({ suggestions: e.target.value })} />
            <div className="hint">Compaiono sotto il benvenuto, massimo 6.</div></div>
          <div className="grid2">
            <div className="field"><label className="label">Posizione</label>
              <select className="select" value={widget.position || 'right'} onChange={(e) => setWidget({ position: e.target.value })}>
                <option value="right">In basso a destra</option><option value="left">In basso a sinistra</option>
              </select></div>
            <div className="field"><label className="label">Anteprima dopo (secondi)</label>
              <input className="input mono" type="number" min="0" max="600" value={widget.teaser_delay ?? 0} onChange={(e) => setWidget({ teaser_delay: Math.max(0, Number(e.target.value) || 0) })} />
              <div className="hint">0 = messaggio di anteprima disattivato.</div></div>
          </div>
          <div className="field"><label className="label">Messaggio di anteprima</label>
            <input className="input" value={widget.teaser_text || ''} maxLength={160} onChange={(e) => setWidget({ teaser_text: e.target.value })} placeholder="Ciao! Hai bisogno di aiuto?" />
            <div className="hint">Nuvoletta accanto al pallino. Se il visitatore la chiude non ricompare più per lui.</div></div>
          <div className="field"><label className="label">Avvertenza in fondo alla chat</label>
            <textarea className="textarea" style={{ minHeight: 56 }} value={widget.disclaimer ?? DEFAULT_DISCLAIMER} onChange={(e) => setWidget({ disclaimer: e.target.value })} />
            <div className="hint">
              Lascia vuoto per non mostrarla. {widget.disclaimer !== DEFAULT_DISCLAIMER && <button type="button" className="btn sm ghost" onClick={() => setWidget({ disclaimer: DEFAULT_DISCLAIMER })}>Ripristina testo predefinito</button>}
            </div></div>
        </div>

        <LivePreview client={client} widget={widget} />
      </div>
      <style>{'@media (max-width: 1100px){.appearance-grid{grid-template-columns:minmax(0,1fr)!important}}'}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ avatar picker (presets or uploaded image) */
/**
 * value: avatar object, or null when `inherit` is given (= "same as the launcher").
 * Removing an uploaded image goes back to the presets (launcher) or to "same as the launcher" (header).
 * Old files stay in the bucket: a removed image may still be the one saved until "Salva tutto" is clicked.
 */
function AvatarPicker({ slot, client, value, inherit, onChange, onRemove, setToast }) {
  const fileRef = useRef(null)
  const [cropFile, setCropFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const cur = value ? { ...DEFAULT_AVATAR, bg: inherit?.bg || DEFAULT_AVATAR.bg, ...value } : null
  const colors = cur || inherit || DEFAULT_AVATAR
  const isImage = cur?.kind === 'image' && !!cur.url
  const set = (patch) => onChange({ ...(cur || { ...DEFAULT_AVATAR, bg: colors.bg, fg: colors.fg }), ...patch })

  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!ACCEPTED.includes(f.type)) return setToast('Formato non supportato: usa PNG, JPG, WebP o GIF')
    if (f.size > MAX_SOURCE_MB * 1024 * 1024) return setToast(`Immagine troppo grande (max ${MAX_SOURCE_MB} MB)`)
    setCropFile(f)
  }

  const upload = async (blob) => {
    if (blob.size > MAX_UPLOAD_BYTES) return setToast('Immagine risultante troppo grande (max 2 MB)')
    setUploading(true)
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png'
    const path = `${client.id}/${slot}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false })
    setUploading(false)
    if (error) return setToast(`Caricamento non riuscito: ${error.message}`)
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    set({ kind: 'image', url: data.publicUrl })
    setCropFile(null)
    setToast('Immagine caricata: ricorda di salvare')
  }

  return (
    <>
      <div className="row wrap" style={{ gap: 10 }}>
        {inherit && (
          <button type="button" title="Uguale al pallino" aria-label="Uguale al pallino" aria-pressed={!cur} onClick={() => onChange(null)}
            style={{ ...avatarTile(!cur), position: 'relative' }}>
            <span style={{ width: '100%', height: '100%', display: 'block', opacity: 0.55 }} dangerouslySetInnerHTML={{ __html: avatarMarkup(inherit) }} />
            <span style={{ position: 'absolute', fontSize: 10, fontWeight: 700, color: 'var(--text)', background: 'var(--surface)', borderRadius: 4, padding: '0 4px' }}>=</span>
          </button>
        )}
        {AVATAR_PRESETS.map((p) => {
          const active = cur?.kind === 'preset' && cur.preset === p.id
          return (
            <button key={p.id} type="button" title={p.label} aria-label={p.label} aria-pressed={active}
              onClick={() => set({ kind: 'preset', preset: p.id })} style={avatarTile(active)}
              dangerouslySetInnerHTML={{ __html: presetSvg(p.id, colors.bg, colors.fg) }} />
          )
        })}
        <button type="button" title={cur?.url ? 'Immagine caricata' : 'Carica immagine'} aria-label={cur?.url ? 'Usa l’immagine caricata' : 'Carica immagine'} aria-pressed={isImage}
          onClick={() => (isImage || !cur?.url ? fileRef.current?.click() : set({ kind: 'image' }))}
          style={{ ...avatarTile(isImage), background: 'var(--surfaceAlt)', color: 'var(--textSecondary)', fontSize: 22 }}>
          {cur?.url ? <img src={cur.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '+'}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPTED.join(',')} hidden onChange={pick} />
      </div>
      {cur && cur.kind === 'preset' && (
        <div className="row wrap" style={{ marginTop: 10, gap: 16 }}>
          <ColorField label="Sfondo" value={cur.bg} onChange={(v) => set({ bg: v })} />
          <ColorField label="Figura" value={cur.fg} onChange={(v) => set({ fg: v })} />
        </div>
      )}
      {isImage && (
        <div className="row wrap" style={{ marginTop: 10, gap: 10 }}>
          <img src={cur.url} alt="Anteprima immagine" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--surface)', boxShadow: '0 0 0 1px var(--border)' }} />
          <button type="button" className="btn sm" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Caricamento…' : 'Cambia immagine'}</button>
          <button type="button" className="btn sm danger" disabled={uploading} onClick={onRemove}>Rimuovi immagine</button>
        </div>
      )}
      {cropFile && <AvatarCropper file={cropFile} busy={uploading} onCancel={() => setCropFile(null)} onDone={upload} />}
    </>
  )
}

const avatarTile = (active) => ({
  width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '3px solid var(--surface)', boxShadow: active ? '0 0 0 2px var(--primary)' : '0 0 0 1px var(--border)', transition: 'box-shadow .15s',
})

function ColorField({ label, value, onChange }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {label && <span className="small secondary">{label}</span>}
      <input type="color" aria-label={label ? `Colore ${label.toLowerCase()}` : 'Colore'} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 38, height: 38, padding: 3, border: '1px solid var(--borderStrong)', borderRadius: 10, background: 'var(--surface)', cursor: 'pointer' }} />
      <input className="input mono" style={{ width: 100 }} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/* ------------------------------------------------------------------ live preview (same code as the widget) */
function LivePreview({ client, widget }) {
  const closedRef = useRef(null)
  const openRef = useRef(null)
  // which host theme to simulate: a light or a dark client site
  const [site, setSite] = useState('light')
  const theme = widget.theme === 'light' || widget.theme === 'dark' ? widget.theme : site
  const cfgKey = JSON.stringify(widget)
  const cfg = useMemo(() => ({ name: client.name, widget: { ...widget, lead_capture: 'off' } }), [cfgKey, client.name])

  useEffect(() => {
    const api = async (b) => {
      await new Promise((r) => setTimeout(r, 900))
      return b.mode === 'message' ? { conversation_id: 'preview', message_id: `p${Date.now()}`, content: PREVIEW_REPLY } : { ok: true }
    }
    // preview only: imitates the streamed reply (dots for ~0.8 s, then the text growing a few words at a time)
    api.stream = async (b, { onDelta } = {}) => {
      await new Promise((r) => setTimeout(r, 800))
      const parts = PREVIEW_REPLY.match(/\S+\s*/g) || [PREVIEW_REPLY]
      for (let i = 0; i < parts.length; i += 3) { onDelta?.(parts.slice(i, i + 3).join('')); await new Promise((r) => setTimeout(r, 45)) }
      return { conversation_id: 'preview', message_id: `p${Date.now()}`, content: PREVIEW_REPLY }
    }
    let a, b
    const t = setTimeout(() => {
      a = mountChat(closedRef.current, { cfg, api, slug: 'preview', mode: 'preview', preview: 'closed', theme })
      b = mountChat(openRef.current, { cfg, api, slug: 'preview', mode: 'preview', preview: 'open', theme })
    }, 150)
    return () => { clearTimeout(t); a?.destroy(); b?.destroy() }
  }, [cfg, theme])

  // the frame imitates the client's site: light or dark page behind the widget
  const frame = {
    position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)',
    background: site === 'dark' ? 'radial-gradient(120% 90% at 80% 0%, rgba(139,108,255,.18), transparent 60%), #07090E' : 'radial-gradient(120% 90% at 80% 0%, rgba(34,230,214,.14), transparent 60%), #F4F5F9',
  }
  return (
    <div className="col" style={{ gap: 10, position: 'sticky', top: 80 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="small secondary">Anteprima dal vivo</span>
        <div className="tabs" role="radiogroup" aria-label="Simula il sito del cliente">
          {[['light', 'Sito chiaro'], ['dark', 'Sito scuro']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={site === k} className={`tab ${site === k ? 'active' : ''}`} style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setSite(k)}>{l}</button>
          ))}
        </div>
      </div>
      <span className="small muted">Chat chiusa</span>
      <div style={{ ...frame, height: 120 }}><div ref={closedRef} style={{ height: '100%' }} /></div>
      <span className="small muted">Chat aperta (puoi scrivere per provare)</span>
      <div style={{ ...frame, height: 640 }}><div ref={openRef} style={{ height: '100%' }} /></div>
    </div>
  )
}

/* ------------------------------------------------------------------ square crop + resize before upload */
const VIEW = 280
const OUT = 256

function AvatarCropper({ file, busy, onCancel, onDone }) {
  const canvasRef = useRef(null)
  const [img, setImg] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { setImg(i); setZoom(1); setOff({ x: 0, y: 0 }) }
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // image size (in viewport px) and offset clamped so the square is always fully covered
  const geom = (z, o) => {
    const base = VIEW / Math.min(img.width, img.height)
    const w = img.width * base * z, h = img.height * base * z
    const mx = (w - VIEW) / 2, my = (h - VIEW) / 2
    return { w, h, x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) }
  }

  const draw = (ctx, size, g) => {
    const k = size / VIEW
    ctx.clearRect(0, 0, size, size)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (size - g.w * k) / 2 + g.x * k, (size - g.h * k) / 2 + g.y * k, g.w * k, g.h * k)
  }

  useEffect(() => {
    if (!img || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    draw(ctx, VIEW, geom(zoom, off))
    // round mask preview: the widget shows the image in a circle
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.rect(0, 0, VIEW, VIEW); ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 1, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.restore()
  }, [img, zoom, off])

  const onDown = (e) => { drag.current = { sx: e.clientX, sy: e.clientY, o: off }; e.currentTarget.setPointerCapture(e.pointerId) }
  const onMove = (e) => {
    if (!drag.current) return
    const g = geom(zoom, { x: drag.current.o.x + e.clientX - drag.current.sx, y: drag.current.o.y + e.clientY - drag.current.sy })
    setOff({ x: g.x, y: g.y })
  }
  const onUp = () => { drag.current = null }

  const confirm = () => {
    const c = document.createElement('canvas')
    c.width = OUT; c.height = OUT
    draw(c.getContext('2d'), OUT, geom(zoom, off))
    c.toBlob((blob) => {
      if (blob && blob.type === 'image/webp') return onDone(blob)
      c.toBlob((png) => png && onDone(png), 'image/png') // browsers without WebP encoding
    }, 'image/webp', 0.9)
  }

  return (
    <Modal open title="Ritaglia l’immagine" onClose={busy ? () => {} : onCancel}>
      {!img ? <div className="empty">Caricamento…</div> : (
        <div className="col" style={{ alignItems: 'center', gap: 14 }}>
          <canvas ref={canvasRef} width={VIEW} height={VIEW} aria-label="Area di ritaglio: trascina per spostare l’immagine"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{ width: VIEW, height: VIEW, borderRadius: 12, cursor: 'grab', touchAction: 'none', background: 'var(--surfaceAlt)' }} />
          <label className="row small secondary" style={{ gap: 10, width: VIEW }}>
            Zoom
            <input type="range" min="1" max="4" step="0.01" value={zoom} style={{ flex: 1 }}
              onChange={(e) => { const z = Number(e.target.value); const g = geom(z, off); setZoom(z); setOff({ x: g.x, y: g.y }) }} />
          </label>
          <div className="hint">Trascina per spostare, usa lo zoom per ingrandire. Verrà salvata un’immagine quadrata di {OUT}×{OUT} px.</div>
          <div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn" disabled={busy} onClick={onCancel}>Annulla</button>
            <button type="button" className="btn primary" disabled={busy} onClick={confirm}>{busy ? 'Caricamento…' : 'Usa immagine'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
