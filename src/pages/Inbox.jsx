import InboxView from '../components/InboxView'
export default function Inbox() {
  return (
    <div className="page">
      <div style={{ marginBottom: 16 }}>
        <h1>Inbox</h1>
        <div className="secondary small" style={{ marginTop: 4 }}>Conversazioni di tutti i clienti in escalation o prese in carico da un operatore.</div>
      </div>
      <InboxView />
    </div>
  )
}
