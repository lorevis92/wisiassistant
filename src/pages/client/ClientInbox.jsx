import InboxView from '../../components/InboxView'
export default function ClientInbox({ client }) {
  return <InboxView clientId={client.id} />
}
