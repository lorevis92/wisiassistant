// deno-lint-ignore-file no-explicit-any
import { sendEmail, mdToHtml } from './common.ts'

export async function sendReport(sb: any, report: any, client: any) {
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;max-width:680px">
    <div style="border-bottom:1px solid #E8E8E8;padding-bottom:10px;margin-bottom:14px"><span style="color:#E8352A;font-weight:800;text-transform:uppercase">WISI Assistant</span> · ${client.name}</div>
    ${mdToHtml(report.body_md || '')}
    <div style="border-top:1px solid #E8E8E8;margin-top:20px;padding-top:10px;font-size:11px;color:#666">Report generato automaticamente dall'assistente AI di ${client.name}.</div></div>`
  await sendEmail(report.recipients, report.subject, html, report.body_md)
  await sb.from('reports').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', report.id)
}
