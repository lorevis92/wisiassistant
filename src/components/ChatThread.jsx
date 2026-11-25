import { fmtTime } from '../lib/utils'
import { renderMessageHtml } from '../lib/utils'
import RetrievalDetails from './RetrievalDetails'

/** Renders a conversation exactly as the end user sees it (bubbles). role: user | assistant | human */
/** showWhy: owner / admin see "Perché ha risposto così" under each assistant answer */
export default function ChatThread({ messages, showTime = true, showWhy = false }) {
  if (!messages?.length) return <div className="empty">Nessun messaggio in questa conversazione</div>
  return (
    <div className="chat">
      {messages.map((m) => (
        <div key={m.id || m.created_at + m.role} className={`msg ${m.role}`}>
          <div dangerouslySetInnerHTML={{ __html: renderMessageHtml(m.content) }} />
          {showTime && (
            <div className="meta">
              {m.role === 'human' ? 'Operatore, ' : ''}{fmtTime(m.created_at)}
              {m.feedback === 1 ? ', risposta utile' : m.feedback === -1 ? ', risposta non utile' : ''}
            </div>
          )}
          {showWhy && m.role === 'assistant' && <RetrievalDetails retrieval={m.retrieval} sources={m.sources} />}
        </div>
      ))}
    </div>
  )
}
