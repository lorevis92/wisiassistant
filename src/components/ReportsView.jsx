import { useEffect, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'
import { StatusBadge, Toast, useToast, Modal, EmptyState } from './ui'
import { fmtDate, fmtDateTime, daysAgo, todayIso } from '../lib/utils'

/**
 * Periodic AI reports. A schedule (per client) generates a draft automatically (Supabase cron → generate-report).
 * Drafts land here; the admin edits, approves and sends (send-report via Resend). Auto-send can be enabled per client.
 */
export default function ReportsView({ client = null }) {
  const [reports, setReports] = useState(null)
  const [clients, setClients] = useState({})
  const [edit, setEdit] = useState(null)
  const [toast, setToast] = useToast()
  const [genOpen, setGenOpen] = useState(false)
  const [range, setRange] = useState({ from: daysAgo(7), to: todayIso() })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    let q = supabase.from('wa_reports').select('*').order('created_at', { ascending: false }).limit(100)
    if (client) q = q.eq('client_id', client.id)
    const { data } = await q
    setReports(data || [])
    if (!client) { const { data: cs } = await supabase.from('wa_clients').select('id,name'); const m = {}; for (const c of cs || []) m[c.id] = c.name; setClients(m) }
  }
  useEffect(() => { load() }, [client?.id])

  const generate = async () => {
    setBusy(true)
    try { await callFunction('generate-report', { client_id: client.id, period_start: range.from, period_end: range.to }); setToast('Report generato come bozza'); setGenOpen(false); load() } catch (e) { setToast(e.message) }
    setBusy(false)
  }
  const save = async () => {
    await supabase.from('wa_reports').update({ subject: edit.subject, body_md: edit.body_md }).eq('id', edit.id)
    setToast('Salvato'); load()
  }
  const approveAndSend = async () => {
    setBusy(true)
    try { await supabase.from('wa_reports').update({ subject: edit.subject, body_md: edit.body_md, status: 'approved' }).eq('id', edit.id); await callFunction('send-report', { report_id: edit.id }); setToast('Report inviato'); setEdit(null); load() } catch (e) { setToast(e.message) }
    setBusy(false)
  }
  const del = async (id) => { if (confirm('Eliminare il report?')) { await supabase.from('wa_reports').delete().eq('id', id); load() } }

  return (
    <div className="col" style={{ gap: 16 }}>
      <Toast msg={toast} />
      {client && (
        <div className="card tight row between wrap">
          <dl className="report-kv">
            <div><dt>Cadenza</dt><dd>{{ weekly: 'Settimanale', biweekly: 'Ogni 2 settimane', monthly: 'Mensile' }[client.report_frequency] || 'Nessuna'}</dd></div>
            <div><dt>Destinatari</dt><dd className="mono">{(client.report_recipients || []).join(', ') || '–'}</dd></div>
            <div><dt>Invio</dt><dd>{client.report_auto_send ? 'Automatico' : 'Dopo la tua approvazione'}</dd></div>
          </dl>
          <style>{`.report-kv{display:flex;flex-wrap:wrap;gap:8px 28px;margin:0;font-size:var(--fs-sm)}.report-kv dt{color:var(--textMuted);font-size:var(--fs-xs)}.report-kv dd{margin:2px 0 0;font-weight:500}`}</style>
          <button className="btn primary" onClick={() => setGenOpen(true)}>Genera report ora</button>
        </div>
      )}
      <div className="card flush">
        {reports?.length === 0 ? <EmptyState icon="chart" title="Nessun report ancora">I report arrivano qui come bozze secondo la cadenza scelta in Impostazioni{client ? ', oppure generane uno adesso.' : '.'}</EmptyState> : (
        <table className="table">
          <thead><tr>{!client && <th>Cliente</th>}<th>Periodo</th><th>Oggetto</th><th>Stato</th><th>Creato</th><th>Inviato</th><th></th></tr></thead>
          <tbody>
            {reports === null && <tr><td colSpan={7} className="empty">Caricamento…</td></tr>}
            {reports?.map((r) => (
              <tr key={r.id}>
                {!client && <td>{clients[r.client_id]}</td>}
                <td className="mono small">{fmtDate(r.period_start)} → {fmtDate(r.period_end)}</td>
                <td><span className="truncate" style={{ maxWidth: 360 }}>{r.subject}</span></td>
                <td><StatusBadge status={r.status} /></td>
                <td className="mono small">{fmtDateTime(r.created_at)}</td>
                <td className="mono small">{fmtDateTime(r.sent_at)}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn sm" onClick={() => setEdit(r)}>{r.status === 'sent' ? 'Apri' : 'Rivedi e invia'}</button>
                    <button className="btn sm danger" aria-label="Elimina il report" title="Elimina" onClick={() => del(r.id)}>Elimina</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      <Modal open={genOpen} title="Genera report" onClose={() => setGenOpen(false)}>
        <div className="row">
          <div><label className="label">Da</label><input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div><label className="label">A</label><input type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        </div>
        <div className="hint">Il report analizza conversazioni, temi ricorrenti, domande senza risposta ed escalation del periodo e propone contenuti da aggiungere al sito.</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn primary" disabled={busy} onClick={generate}>{busy ? 'Generazione…' : 'Genera bozza'}</button></div>
      </Modal>

      <Modal open={!!edit} title="Report" onClose={() => setEdit(null)} width={820}>
        {edit && (
          <>
            <div className="field"><label className="label">Oggetto email</label><input className="input" value={edit.subject || ''} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} disabled={edit.status === 'sent'} /></div>
            <div className="field"><label className="label">Contenuto (Markdown)</label><textarea className="textarea mono" style={{ minHeight: 380 }} value={edit.body_md || ''} onChange={(e) => setEdit({ ...edit, body_md: e.target.value })} disabled={edit.status === 'sent'} /></div>
            <div className="small secondary" style={{ marginBottom: 10 }}>Destinatari: <span className="mono">{(edit.recipients || []).join(', ') || '— (imposta in Impostazioni → Report)'}</span></div>
            {edit.status !== 'sent' && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={save}>Salva bozza</button>
                <button className="btn primary" disabled={busy || !(edit.recipients || []).length} onClick={approveAndSend}>{busy ? 'Invio…' : 'Approva e invia'}</button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
