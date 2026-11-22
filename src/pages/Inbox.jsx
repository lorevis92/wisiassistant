import InboxView from '../components/InboxView'
export default function Inbox() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="lead" style={{ margin: '6px 0 0' }}>Le conversazioni di tutti i clienti passate a un operatore o prese in carico.</p>
        </div>
      </div>
      <InboxView />
    </div>
  )
}
