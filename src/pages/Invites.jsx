import ReceivedInvites from '../components/ReceivedInvites'

/** "Inviti ricevuti": invitations to other organizations for an account that is already a member somewhere. */
export default function Invites() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inviti ricevuti</h1>
          <p className="lead" style={{ margin: '6px 0 0' }}>Entri in un’organizzazione solo se accetti. Puoi anche rifiutare.</p>
        </div>
      </div>
      <ReceivedInvites />
    </div>
  )
}
