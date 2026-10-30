// deno-lint-ignore-file no-explicit-any
import { admin, json, err, CORS, requireAdmin } from '../_shared/common.ts'
import { sendReport } from '../_shared/report.ts'

/** Sends an approved report by email (admin). { report_id } */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const denied = await requireAdmin(req)
  if (denied) return denied
  let b: any
  try { b = await req.json() } catch { return err('JSON non valido') }
  const sb = admin()
  const { data: report } = await sb.from('wa_reports').select('*, client:wa_clients(*)').eq('id', b.report_id).single()
  if (!report) return err('Report non trovato', 404)
  if (!report.recipients?.length) return err('Nessun destinatario: impostali in Impostazioni → Report')
  try {
    await sendReport(sb, report, report.client)
    return json({ ok: true })
  } catch (e) {
    await sb.from('wa_reports').update({ status: 'error', error: (e as Error).message }).eq('id', report.id)
    return err((e as Error).message, 500)
  }
})
