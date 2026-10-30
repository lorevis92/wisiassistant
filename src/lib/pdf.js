import { fmtDateTime } from './utils'

const CH = { web: 'Widget sito', standalone: 'Pagina standalone', telegram: 'Telegram', whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', email: 'Email' }

/**
 * Exports a list of conversations (each with .messages[]) into a single PDF, keeping the chat layout
 * (user bubbles on the right, assistant on the left) as the end user sees it.
 */
// jsPDF built-in fonts only cover Latin-1: normalise typographic chars and drop emoji so nothing renders as garbage.
const safe = (s) => String(s ?? '')
  .replace(/→/g, '->').replace(/…/g, '...').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
  .replace(/[^\x00-\xFF]/g, '')

export async function exportConversationsPdf({ clientName, from, to, conversations }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 40
  let y = M

  const newPage = () => { doc.addPage(); y = M }
  const ensure = (h) => { if (y + h > H - M) newPage() }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text(safe(`${clientName} - Conversazioni`), M, y); y += 20
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(102)
  doc.text(safe(`Periodo: ${from} -> ${to} · ${conversations.length} conversazioni · generato il ${fmtDateTime(new Date())}`), M, y); y += 24
  doc.setTextColor(17)

  for (const c of conversations) {
    ensure(40)
    doc.setDrawColor(232); doc.line(M, y, W - M, y); y += 14
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.text(safe(`Conversazione ${c.id.slice(0, 8)} · ${CH[c.channel] || c.channel} · ${fmtDateTime(c.created_at)}`), M, y); y += 14
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(102)
    const meta = [c.status === 'escalated' ? 'Escalation' : c.status === 'resolved' ? 'Risolta' : 'Aperta', c.lead_name ? `Lead: ${c.lead_name}` : null, c.lead_email || null].filter(Boolean).join(' · ')
    doc.text(safe(meta), M, y); y += 12
    doc.setTextColor(17)

    for (const m of c.messages || []) {
      const isUser = m.role === 'user'
      const bw = (W - 2 * M) * 0.72
      doc.setFontSize(10)
      const lines = doc.splitTextToSize(safe(m.content), bw - 16)
      const bh = lines.length * 12 + 22
      ensure(bh + 6)
      const x = isUser ? W - M - bw : M
      if (isUser) { doc.setFillColor(232, 53, 42); doc.setTextColor(255) } else if (m.role === 'human') { doc.setFillColor(255, 255, 255); doc.setDrawColor(232, 53, 42); doc.setTextColor(17) } else { doc.setFillColor(248, 248, 248); doc.setDrawColor(232); doc.setTextColor(17) }
      doc.roundedRect(x, y, bw, bh, 5, 5, isUser ? 'F' : 'FD')
      doc.text(lines, x + 8, y + 14)
      doc.setFontSize(7); doc.setTextColor(isUser ? 255 : 170)
      doc.text(`${m.role === 'human' ? 'Operatore · ' : ''}${fmtDateTime(m.created_at)}`, x + 8, y + bh - 6)
      doc.setTextColor(17)
      y += bh + 6
    }
    y += 10
  }

  doc.save(`${clientName.replace(/[^a-z0-9]+/gi, '_')}_conversazioni_${from}_${to}.pdf`)
}
