import { fmtTime } from '../lib/utils'
import { renderMessageHtml } from '../lib/utils'

/** Renders a conversation exactly as the end user sees it (bubbles). role: user | assistant | human */
export default function ChatThread({ messages, showTime = true }) {
  if (!messages?.length) return <div className="empty">Nessun messaggio</div>
  return (
    <div className="chat">
      {messages.map((m) => (
        <div key={m.id || m.created_at + m.role} className={`msg ${m.role}`}>
          <div dangerouslySetInnerHTML={{ __html: renderMessageHtml(m.content) }} />
          {showTime && (
            <div className="meta">
              {m.role === 'human' ? 'Operatore · ' : ''}{fmtTime(m.created_at)}
              {m.feedback === 1 ? ' · 👍' : m.feedback === -1 ? ' · 👎' : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
