import { useState } from 'react'
import { supabase, callCrawler } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/utils'
import { instructionConflicts } from '../../lib/instructions'
import Appearance from './Appearance'
import { resolveAvatar } from '../../../widget/avatars.js'
import { DEFAULT_DISCLAIMER } from '../../../widget/chat-ui.js'
import { StatusBadge, Toast, useToast } from '../../components/ui'
import { MODELS, modelKey, supportsTemperature, CHANNELS, LANGS } from '../../lib/models'

const DEFAULT_INSTRUCTIONS = `Sei l'assistente virtuale di {{nome}}. Rispondi in modo cortese, chiaro e conciso, nella lingua in cui scrive l'utente.
Usa SOLO le informazioni fornite nel contesto (pagine del sito e documenti del cliente). Se la risposta non è nel contesto, dillo con onestà.
Quando l'informazione proviene da una pagina del sito, includi il link alla pagina (e alla sezione, se disponibile) in modo naturale nella risposta, per aiutare l'utente a orientarsi nel sito.
Non inventare prezzi, date o condizioni. Non promettere cose che non sono scritte nel contesto.`

export default function Settings({ client, reload }) {
  const [f, setF] = useState({
    name: client.name || '', domain: client.domain || '', slug: client.slug || '',
    model: client.model || modelKey(MODELS[0]), language: client.language || 'auto',
    instructions: client.instructions || DEFAULT_INSTRUCTIONS.replaceAll('{{nome}}', client.name || 'questa azienda'),
    confidence_threshold: client.confidence_threshold ?? 0.35,
    temperature: client.temperature ?? 0.2,
    escalation_email: client.escalation_email || '',
    channels: client.channels || ['web', 'standalone'],
    allowed_domains: (client.allowed_domains || []).join('\n'),
    widget: {
      color: '#E8352A', title: 'Assistente', welcome: 'Ciao! Come posso aiutarti?', suggestions: [], position: 'right', avatar_url: '', lead_capture: 'off', lead_fields: ['name', 'email'],
      teaser_text: 'Ciao! Hai bisogno di aiuto?', teaser_delay: 0, disclaimer: DEFAULT_DISCLAIMER, human_handoff: false,
      ...(client.widget || {}),
      avatar: resolveAvatar(client.widget),
    },
    report_frequency: client.report_frequency || 'none',
    recrawl_frequency: client.recrawl_frequency || 'none',
    report_recipients: (client.report_recipients || []).join(', '),
    report_auto_send: !!client.report_auto_send,
    telegram_bot_token: client.telegram_bot_token || '',
    whatsapp_phone_id: client.whatsapp_phone_id || '',
    whatsapp_token: client.whatsapp_token || '',
    rate_limit_per_hour: client.rate_limit_per_hour ?? 60,
    status: client.status,
  })
  const [toast, setToast] = useToast()
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF({ ...f, [k]: v })
  const setW = (k, v) => setF({ ...f, widget: { ...f.widget, [k]: v } })
  const patchW = (patch) => setF((prev) => ({ ...prev, widget: { ...prev.widget, ...patch } }))

  const save = async () => {
    setBusy(true)
    const domain = f.domain.trim()
    const payload = {
      ...f,
      // the crawler and the widget domain lock need a full URL: "www.site.it" → "https://www.site.it"
      domain: domain && !/^https?:\/\//i.test(domain) ? `https://${domain}` : domain,
      allowed_domains: f.allowed_domains.split('\n').map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean),
      report_recipients: f.report_recipients.split(',').map((s) => s.trim()).filter(Boolean),
      confidence_threshold: Number(f.confidence_threshold), temperature: Number(f.temperature), rate_limit_per_hour: Number(f.rate_limit_per_hour),
      widget: {
        ...f.widget,
        suggestions: (typeof f.widget.suggestions === 'string' ? f.widget.suggestions.split('\n') : f.widget.suggestions).map((s) => s.trim()).filter(Boolean),
        teaser_delay: Math.max(0, Number(f.widget.teaser_delay) || 0),
        disclaimer: String(f.widget.disclaimer ?? '').trim(),
        // legacy field kept in sync for older widget builds
        avatar_url: f.widget.avatar?.kind === 'image' ? f.widget.avatar.url : '',
      },
    }
    const { error } = await supabase.from('wa_clients').update(payload).eq('id', client.id)
    setBusy(false)
    if (error) return setToast(error.message)
    setToast('Impostazioni salvate'); reload()
  }

  const recrawlNow = async () => {
    try { await callCrawler('/recrawl', { client_id: client.id }); setToast('Re-crawl avviato: segui l’avanzamento nella scheda Crawling') } catch (e) { setToast(e.message) }
  }

  const handoff = f.widget.human_handoff === true
  const conflicts = instructionConflicts(f.instructions, handoff)

  const toggleChannel = (id) => set('channels', f.channels.includes(id) ? f.channels.filter((c) => c !== id) : [...f.channels, id])
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      <div className="sticky-actions row between">
        <span className="section-label">Impostazioni cliente</span>
        <div className="row">
          <select className="select" style={{ width: 140 }} value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="ready">Attivo</option><option value="paused">In pausa</option><option value="new">Nuovo</option>
          </select>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Salvataggio…' : 'Salva tutto'}</button>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Generale</div>
          <div className="field"><label className="label">Nome</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label className="label">Sito principale</label><input className="input mono" value={f.domain} onChange={(e) => set('domain', e.target.value)} /></div>
          <div className="field"><label className="label">Slug</label><input className="input mono" value={f.slug} onChange={(e) => set('slug', e.target.value)} /></div>
          <div className="field">
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" className="checkbox" checked={handoff} onChange={(e) => setW('human_handoff', e.target.checked)} />
              <span className="label" style={{ margin: 0 }}>Passaggio a operatore</span>
            </label>
            <div className="hint">
              {handoff
                ? 'Attivo: se il bot non sa rispondere o l’utente chiede una persona, la conversazione va in Inbox (con email qui sotto) e un operatore può rispondere nella chat.'
                : 'Spento (consigliato): l’assistente non propone mai di passare a un operatore né di far ricontattare. Quando non può aiutare, invita una sola volta a rivolgersi alla struttura con i contatti ufficiali indicati nelle istruzioni o nei contenuti.'}
            </div>
          </div>
          {handoff && (
            <div className="field"><label className="label">Email per escalation</label><input className="input mono" placeholder="supporto@cliente.ch" value={f.escalation_email} onChange={(e) => set('escalation_email', e.target.value)} />
              <div className="hint">Qui arriva la cronologia delle conversazioni passate a un operatore.</div></div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Intelligenza artificiale</div>
          <div className="field"><label className="label">Modello</label>
            <select className="select" value={f.model} onChange={(e) => set('model', e.target.value)}>
              {MODELS.map((m) => <option key={modelKey(m)} value={modelKey(m)}>{m.label} — {m.tier}</option>)}
            </select>
            <div className="hint">Ogni provider richiede la propria API key nei secrets di Supabase (vedi README). Puoi cambiare modello in qualsiasi momento.</div>
          </div>
          <div className="grid2">
            <div className="field"><label className="label">Lingua risposte</label>
              <select className="select" value={f.language} onChange={(e) => set('language', e.target.value)}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
            {supportsTemperature(f.model) && (
              <div className="field"><label className="label">Temperatura</label><input className="input mono" type="number" step="0.1" min="0" max="1" value={f.temperature} onChange={(e) => set('temperature', e.target.value)} />
                <div className="hint">Per i modelli Claude (Anthropic) e GPT-5 la temperatura non è usata.</div></div>
            )}
          </div>
          <div className="field"><label className="label">Soglia di confidenza (0–1)</label><input className="input mono" type="number" step="0.05" min="0" max="1" value={f.confidence_threshold} onChange={(e) => set('confidence_threshold', e.target.value)} />
            <div className="hint">Sotto questa similarità il bot dichiara di non avere l’informazione invece di inventare{handoff ? ' e propone il passaggio a un operatore' : ' e, se serve, indica i contatti ufficiali della struttura'}. 0.35 è un buon punto di partenza.</div></div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Istruzioni per l’assistente (descrizione)</div>
        <textarea className="textarea" style={{ minHeight: 200 }} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} />
        <div className="hint">Tono, regole, cose da non dire, come usare i link, contatti ufficiali della struttura (telefono, email, orari). Le informazioni di contesto (pagine, FAQ, documenti) vengono aggiunte automaticamente con URL e sezione di ogni frammento. Le regole di base su contatti e operatori valgono per tutti i clienti e prevalgono su queste istruzioni.</div>
        {conflicts.length > 0 && (
          <div className="card tight" style={{ marginTop: 10, borderColor: 'var(--yellow, #B87000)' }} role="note">
            <div className="small"><b>⚠ {conflicts.length === 1 ? 'Una frase contraddice' : `${conflicts.length} frasi contraddicono`} le regole di base</b> {handoff ? '' : '(passaggio a operatore spento)'}: verrà ignorata, ma è meglio toglierla o riscriverla.</div>
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {conflicts.map((c, i) => <li key={i}>“{c.sentence}” <span className="secondary">— {c.reason}</span></li>)}
            </ul>
          </div>
        )}
      </div>

      <Appearance client={client} widget={f.widget} setWidget={patchW} setToast={setToast} />

      <div className="grid2">
        <div className="card">
          <div className="card-title">Widget e accesso</div>
          <div className="field"><label className="label">Raccolta lead</label>
            <select className="select" value={f.widget.lead_capture} onChange={(e) => setW('lead_capture', e.target.value)}>
              <option value="off">Disattivata</option><option value="before">Prima di iniziare la chat</option>
              <option value="after" disabled={!handoff}>Dopo il primo scambio{handoff ? '' : ' (richiede passaggio a operatore)'}</option>
            </select>
            <div className="hint">{handoff ? 'Il modulo chiede nome ed email al visitatore.' : 'Con il passaggio a operatore spento, l’assistente non chiede mai i contatti di sua iniziativa: resta solo il modulo facoltativo prima della chat.'}</div>
            {!handoff && ['after', 'escalation'].includes(f.widget.lead_capture) && <div className="hint" style={{ color: 'var(--primary)' }}>L’opzione salvata non è attiva finché il passaggio a operatore è spento.</div>}
          </div>
          <div className="field"><label className="label">Domini autorizzati (uno per riga)</label><textarea className="textarea mono" style={{ minHeight: 70 }} value={f.allowed_domains} onChange={(e) => set('allowed_domains', e.target.value)} />
            <div className="hint">Lascia vuoto per far funzionare il widget su qualsiasi sito. Aggiungi domini solo se vuoi limitarlo a quei siti. Localhost e file:// sono sempre ammessi per i test.</div></div>
          <div className="field"><label className="label">Limite messaggi per visitatore / ora</label><input className="input mono" type="number" value={f.rate_limit_per_hour} onChange={(e) => set('rate_limit_per_hour', e.target.value)} /></div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">Canali</div>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              {CHANNELS.map((c) => (
                <label key={c.id} className="chip" style={{ cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
                  <input type="checkbox" className="checkbox" checked={f.channels.includes(c.id)} onChange={() => toggleChannel(c.id)} /> {c.label}
                </label>
              ))}
            </div>
            <div className="field"><label className="label">Telegram bot token</label><input className="input mono" placeholder="123456:ABC…" value={f.telegram_bot_token} onChange={(e) => set('telegram_bot_token', e.target.value)} />
              <div className="hint">Crea il bot con @BotFather, incolla il token, salva, poi registra il webhook: <span className="mono">{fnUrl}/telegram-webhook?client={client.slug}</span> (comando in README).</div></div>
            <div className="field"><label className="label">WhatsApp Phone Number ID</label><input className="input mono" value={f.whatsapp_phone_id} onChange={(e) => set('whatsapp_phone_id', e.target.value)} /></div>
            <div className="field"><label className="label">WhatsApp access token</label><input className="input mono" value={f.whatsapp_token} onChange={(e) => set('whatsapp_token', e.target.value)} />
              <div className="hint">Meta Business → WhatsApp Cloud API. Webhook: <span className="mono">{fnUrl}/whatsapp-webhook?client={client.slug}</span>. Instagram/Messenger usano lo stesso endpoint quando collegati nella Meta App.</div></div>
          </div>
          <div className="card">
            <div className="card-title">Crawling</div>
            <div className="field"><label className="label">Re-crawl automatico del sito</label>
              <select className="select" value={f.recrawl_frequency} onChange={(e) => set('recrawl_frequency', e.target.value)}>
                <option value="none">Nessuno</option><option value="daily">Giornaliero</option><option value="weekly">Settimanale</option><option value="monthly">Mensile</option>
              </select>
              <div className="hint">Ogni notte (02:30 UTC) il sistema rimappa il sito dei clienti in scadenza, rispetta le regole include/exclude, indicizza le pagine nuove, aggiorna solo quelle cambiate e disattiva quelle sparite. Documenti, FAQ e testi caricati a mano non vengono mai toccati. I clienti in pausa vengono saltati.</div>
            </div>
            <div className="row between wrap">
              <span className="small secondary">
                Ultimo re-crawl: {client.last_recrawl_at ? fmtDateTime(client.last_recrawl_at) : 'mai'}
                {client.last_recrawl_status ? <> · <StatusBadge status={client.last_recrawl_status === 'error' ? 'failed' : client.last_recrawl_status} /></> : null}
              </span>
              <button className="btn sm" disabled={!client.domain} onClick={recrawlNow}>Esegui ora</button>
            </div>
            {client.last_recrawl_status === 'error' && client.last_recrawl_error && <div className="hint" style={{ color: 'var(--primary)' }}>{client.last_recrawl_error}</div>}
          </div>
          <div className="card">
            <div className="card-title">Report periodici</div>
            <div className="grid2">
              <div className="field"><label className="label">Cadenza</label>
                <select className="select" value={f.report_frequency} onChange={(e) => set('report_frequency', e.target.value)}>
                  <option value="none">Nessuna</option><option value="weekly">Settimanale (lunedì)</option><option value="biweekly">Ogni 2 settimane</option><option value="monthly">Mensile (1° del mese)</option>
                </select></div>
              <div className="field"><label className="label">Invio</label>
                <select className="select" value={f.report_auto_send ? '1' : '0'} onChange={(e) => set('report_auto_send', e.target.value === '1')}>
                  <option value="0">Dopo mia approvazione</option><option value="1">Automatico</option>
                </select></div>
            </div>
            <div className="field"><label className="label">Destinatari (separati da virgola)</label><input className="input mono" placeholder="direzione@cliente.ch, marketing@cliente.ch" value={f.report_recipients} onChange={(e) => set('report_recipients', e.target.value)} /></div>
          </div>
        </div>
      </div>
    </div>
  )
}
