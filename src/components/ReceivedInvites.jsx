import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth, ROLE_LABEL } from '../lib/auth'
import { fmtDateTime } from '../lib/utils'
import { EmptyState } from './ui'

/**
 * Invitations received by the signed-in account (database function wa_my_invites: verified email only).
 * Accept joins the organization with the invited role and clients; Decline closes the invite for good.
 */
export default function ReceivedInvites({ compact = false }) {
  const { invites, refresh, selectOrg } = useAuth()
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const nav = useNavigate()

  const respond = async (inv, accept) => {
    setBusy(inv.id); setErr('')
    const { error } = await supabase.rpc('wa_respond_invite', { p_invite: inv.id, p_accept: accept })
    setBusy(null)
    if (error) return setErr(error.message)
    if (accept) selectOrg(inv.org_id)
    await refresh()
    if (accept) nav('/', { replace: true })
  }

  if (!invites.length) {
    return compact ? null : <EmptyState icon="inbox" title="Nessun invito ricevuto">Quando qualcuno ti invita in un’organizzazione, l’invito compare qui.</EmptyState>
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      {err && <div className="callout danger" role="alert">{err}</div>}
      {invites.map((i) => (
        <div key={i.id} className="card tight glow row between wrap" style={{ gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--heading)' }}>{i.org_name}</div>
            <div className="small secondary">
              {ROLE_LABEL[i.role]}{i.role === 'collaborator' ? ` su ${i.client_count} ${i.client_count === 1 ? 'cliente' : 'clienti'}` : ''}
              {i.invited_by ? `, invito di ${i.invited_by}` : ''}. Scade il {fmtDateTime(i.expires_at)}.
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" disabled={busy === i.id} onClick={() => respond(i, false)}>Rifiuta</button>
            <button className="btn primary" disabled={busy === i.id} onClick={() => respond(i, true)}>{busy === i.id ? 'Un momento…' : 'Accetta'}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
