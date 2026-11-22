// deno-lint-ignore-file no-explicit-any
import { sendEmail, mdToHtml } from './common.ts'

export async function sendReport(sb: any, report: any, client: any) {
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#10232F;max-width:680px">
    <div style="border-bottom:3px solid #0F5A7F;padding-bottom:12px;margin-bottom:16px"><span style="color:#0F5A7F;font-weight:700;font-size:18px;letter-spacing:-0.02em">Sardesk</span><span style="color:#D9472F">&nbsp;&#9679;</span> <span style="color:#4C5A61">${client.name}</span></div>
    ${mdToHtml(report.body_md || '')}
    <div style="border-top:1px solid #E0E3DC;margin-top:22px;padding-top:10px;font-size:11px;color:#7A858A">Report generato automaticamente da Sardesk, l'assistente AI di ${client.name}.</div></div>`
  await sendEmail(report.recipients, report.subject, html, report.body_md)
  await sb.from('wa_reports').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', report.id)
}
