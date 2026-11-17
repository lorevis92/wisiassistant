import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/ui'
import { AVATAR_PRESETS, presetSvg, resolveAvatar } from '../../../widget/avatars.js'
import { DEFAULT_DISCLAIMER, mountChat } from '../../../widget/chat-ui.js'

const BUCKET = 'wa-avatars'
const PREVIEW_REPLY = 'Questa è un’anteprima: qui comparirà la risposta dell’assistente, con i **dettagli importanti** in evidenza e i link alle pagine del sito, ad esempio [Camere e suite](https://example.com/camere).'

/**
 * "Aspetto" section of the client settings: avatar, name, texts, colour, position, preview bubble, disclaimer,
 * with a live preview rendered by the same code as the real widget (widget/chat-ui.js).
 * Values live in clients.widget and reach the widget through the public config of the `chat` function.
 */
export default function Appearance({ client, widget, setWidget, setToast }) {
  const avatar = resolveAvatar(widget)
  const setAvatar = (patch) => setWidget({ avatar: { ...avatar, ...patch } })
  const [cropFile, setCropFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const suggestions = Array.isArray(widget.suggestions) ? widget.suggestions.join('\n') : widget.suggestions || ''

  const upload = async (blob) => {
    setUploading(true)
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png'
    const path = `${client.id}/avatar-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false })
    setUploading(false)
    if (error) return setToast(`Caricamento non riuscito: ${error.message}`)
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    setAvatar({ kind: 'image', url: data.publicUrl })
    setCropFile(null)
    setToast('Immagine caricata: ricorda di salvare')
  }

  return (
    <div className="card">
      <div className="card-title">Aspetto</div>
      <div className="appearance-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 24, alignItems: 'start' }}>
        <div className="col" style={{ gap: 0 }}>
          <div className="field">
            <label className="label">Immagine del pallino e della testata</label>
            <div className="row wrap" style={{ gap: 10 }}>
              {AVATAR_PRESETS.map((p) => (
                <button key={p.id} type="button" title={p.label} aria-label={p.label} aria-pressed={avatar.kind === 'preset' && avatar.preset === p.id}
                  onClick={() => setAvatar({ kind: 'preset', preset: p.id })}
                  style={avatarTile(avatar.kind === 'preset' && avatar.preset === p.id)}
                  dangerouslySetInnerHTML={{ __html: presetSvg(p.id, avatar.bg, avatar.fg) }} />
              ))}
              <button type="button" title="Carica immagine" aria-label="Carica immagine" aria-pressed={avatar.kind === 'image'}
                onClick={() => (avatar.kind === 'image' || !avatar.url ? fileRef.current?.click() : setAvatar({ kind: 'image' }))}
                style={{ ...avatarTile(avatar.kind === 'image'), background: '#f3f4f6', color: '#57606a', fontSize: 22 }}>
                {avatar.url ? <img src={avatar.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '+'}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCropFile(f) }} />
            </div>
            {avatar.kind === 'preset' ? (
              <div className="row wrap" style={{ marginTop: 10, gap: 16 }}>
                <ColorField label="Sfondo" value={avatar.bg} onChange={(v) => setAvatar({ bg: v })} />
                <ColorField label="Figura" value={avatar.fg} onChange={(v) => setAvatar({ fg: v })} />
              </div>
            ) : (
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn sm" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Caricamento…' : 'Cambia immagine'}</button>
              </div>
            )}
            <div className="hint">Le immagini caricate vengono ritagliate quadrate e ridimensionate a 256 px prima del caricamento.</div>
          </div>

          <div className="grid2">
            <div className="field"><label className="label">Nome dell’assistente</label>
              <input className="input" value={widget.title || ''} onChange={(e) => setWidget({ title: e.target.value })} maxLength={80} /></div>
            <div className="field"><label className="label">Colore principale</label>
              <ColorField value={widget.color} onChange={(v) => setWidget({ color: v })} /></div>
          </div>
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
      {cropFile && <AvatarCropper file={cropFile} busy={uploading} onCancel={() => setCropFile(null)} onDone={upload} />}
    </div>
  )
}

const avatarTile = (active) => ({
  width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '3px solid #fff', boxShadow: active ? '0 0 0 2px var(--text, #111)' : '0 0 0 1px var(--border, #ddd)',
})

function ColorField({ label, value, onChange }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {label && <span className="small secondary">{label}</span>}
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'none' }} />
      <input className="input mono" style={{ width: 100 }} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/* ------------------------------------------------------------------ live preview (same code as the widget) */
function LivePreview({ client, widget }) {
  const closedRef = useRef(null)
  const openRef = useRef(null)
  const cfgKey = JSON.stringify(widget)
  const cfg = useMemo(() => ({ name: client.name, widget: { ...widget, lead_capture: 'off' } }), [cfgKey, client.name])

  useEffect(() => {
    const api = async (b) => {
      await new Promise((r) => setTimeout(r, 900))
      return b.mode === 'message' ? { conversation_id: 'preview', message_id: `p${Date.now()}`, content: PREVIEW_REPLY } : { ok: true }
    }
    let a, b
    const t = setTimeout(() => {
      a = mountChat(closedRef.current, { cfg, api, slug: 'preview', mode: 'preview', preview: 'closed' })
      b = mountChat(openRef.current, { cfg, api, slug: 'preview', mode: 'preview', preview: 'open' })
    }, 150)
    return () => { clearTimeout(t); a?.destroy(); b?.destroy() }
  }, [cfg])

  const frame = { position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(180deg,#f6f7f9,#eceef1)', border: '1px solid var(--border, #e5e5e5)' }
  return (
    <div className="col" style={{ gap: 10, position: 'sticky', top: 80 }}>
      <span className="small secondary">Anteprima dal vivo · chat chiusa</span>
      <div style={{ ...frame, height: 120 }}><div ref={closedRef} style={{ height: '100%' }} /></div>
      <span className="small secondary">Chat aperta (puoi scrivere per provare)</span>
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
            style={{ width: VIEW, height: VIEW, borderRadius: 8, cursor: 'grab', touchAction: 'none', background: '#eee' }} />
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
