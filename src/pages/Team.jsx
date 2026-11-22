import { useEffect, useMemo, useState } from 'react'
import { supabase, callFunction } from '../lib/supabase'
import { useAuth, ROLE_LABEL } from '../lib/auth'
import { APP_URL } from '../lib/brand'
import { Modal, Toast, useToast, EmptyState, Spinner } from '../components/ui'
import { fmtDate, fmtDateTime } from '../lib/utils'

/**
 * Team of the organization in use.
 *  - owner / admin: members and roles, clients assigned to each collaborator, pending invites, new invites (admin or collaborator).
 *  - collaborator: can only invite other collaborators on clients assigned to them, and see / revoke their own invites.
 * Every change goes through database functions (migration 0006) that enforce the same rules server side.
 */
const inviteLink = (token) => `${APP_URL}/invite/${token}`
const errMsg = (e) => e?.message || 'Operazione non riuscita'

export default function Team() {
  const { org, isOrgAdmin, session, legacy, refresh } = useAuth()
  const [members, setMembers] = useState(null)
  const [assign, setAssign] = useState([])
  const [invites, setInvites] = useState(null)
  const [clients, setClients] = useState([])
  const [toast, setToast] = useToast()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [link, setLink] = useState(null) // { email, token, emailed }
  const [editAssign, setEditAssign] = useState(null) // member
  const [orgName, setOrgName] = useState(org?.name || '')

  const load = async () => {
    if (!org?.id) return
    const [{ data: cs }, { data: inv }] = await Promise.all([
      supabase.from('wa_clients').select('id,name').eq('org_id', org.id).order('name'),
      supabase.from('wa_invites').select('*').eq('org_id', org.id).is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false }),
    ])
    setClients(cs || []); setInvites(inv || [])
    if (isOrgAdmin) {
      const [{ data: ms }, { data: as }] = await Promise.all([
        supabase.from('wa_org_members').select('user_id, role, email, created_at').eq('org_id', org.id).order('created_at'),
        supabase.from('wa_client_assignments').select('client_id, user_id').eq('org_id', org.id),
      ])
      const order = { owner: 0, admin: 1, collaborator: 2 }
      setMembers((ms || []).sort((a, b) => order[a.role] - order[b.role])); setAssign(as || [])
    }
  }
  useEffect(() => { setOrgName(org?.name || ''); load() }, [org?.id, isOrgAdmin])

  const clientName = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients])
  const assignedTo = (uid) => assign.filter((a) => a.user_id === uid).map((a) => a.client_id)

  const rpc = async (fn, args, done) => {
    const { error } = await supabase.rpc(fn, args)
    if (error) return setToast(errMsg(error))
    if (done) setToast(done)
    load()
  }

  // after creating / renewing: show the link, and email it too if Resend is configured (send-invite function)
  const showLink = async (inv, email) => {
    setLink({ email, token: inv.token, emailed: null })
    try {
      const r = await callFunction('send-invite', { invite_id: inv.id, token: inv.token })
      setLink((l) => (l && l.token === inv.token ? { ...l, emailed: r.sent ? 'sent' : 'off' } : l))
    } catch { setLink((l) => (l && l.token === inv.token ? { ...l, emailed: 'off' } : l)) }
  }
  const renew = async (inv) => {
    const { data, error } = await supabase.rpc('wa_renew_invite', { p_invite: inv.id, p_days: 7 })
    if (error) return setToast(errMsg(error))
    load(); showLink(data, inv.email)
  }

  const saveOrgName = async () => {
    const name = orgName.trim()
    if (!name || name === org.name) return
    const { error } = await supabase.from('wa_organizations').update({ name }).eq('id', org.id)
    if (error) return setToast(errMsg(error))
    setToast('Nome aggiornato'); refresh()
  }

  if (legacy) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Team</h1></div></div>
        <div className="callout warn">Il team si attiva dopo la migrazione <span className="mono">0006_organizations.sql</span> (vedi README). Fino ad allora l’accesso resta quello di prima.</div>
      </div>
    )
  }
  if (!org) return <Spinner />

  const limits = org.limits || {}
  const pending = invites || []

  return (
    <div className="page">
      <Toast msg={toast} />
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="lead" style={{ margin: '6px 0 0' }}>
            {isOrgAdmin ? `Chi lavora in ${org.name}, con quale ruolo e su quali clienti.` : 'Puoi invitare altri collaboratori sui clienti che ti sono assegnati.'}
          </p>
        </div>
        <button className="btn primary" onClick={() => setInviteOpen(true)} disabled={!isOrgAdmin && !clients.length}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {isOrgAdmin ? 'Invita' : 'Invita un collaboratore'}
        </button>
      </div>

      <div className="col" style={{ gap: 16 }}>
        {isOrgAdmin && (
          <div className="card flush">
            <div className="pane-head"><span className="section-label">Membri{members ? ` (${members.length})` : ''}</span></div>
            {members === null ? <Spinner /> : (
              <table className="table">
                <thead><tr><th>Persona</th><th style={{ width: 190 }}>Ruolo</th><th>Clienti</th><th>Dal</th><th></th></tr></thead>
                <tbody>
                  {members.map((m) => {
                    const mine = m.user_id === session.user.id
                    const ids = assignedTo(m.user_id)
                    return (
                      <tr key={m.user_id}>
                        <td><span style={{ fontWeight: 600, color: 'var(--heading)' }}>{m.email || m.user_id.slice(0, 8)}</span>{mine && <span className="small muted"> (tu)</span>}</td>
                        <td>
                          {m.role === 'owner' ? <span className="badge green">Owner</span> : (
                            <select className="select" aria-label={`Ruolo di ${m.email}`} value={m.role} style={{ padding: '6px 30px 6px 10px', fontSize: 13 }}
                              onChange={(e) => rpc('wa_set_member_role', { p_org: org.id, p_user: m.user_id, p_role: e.target.value }, 'Ruolo aggiornato')}>
                              <option value="admin">Admin</option><option value="collaborator">Collaboratore</option>
                            </select>
                          )}
                        </td>
                        <td>
                          {m.role === 'collaborator' ? (
                            <button className="btn sm" onClick={() => setEditAssign(m)} title={ids.map((id) => clientName[id]).filter(Boolean).join(', ')}>
                              {ids.length ? `${ids.length} ${ids.length === 1 ? 'cliente' : 'clienti'}` : 'Nessuno'} · Modifica
                            </button>
                          ) : <span className="small muted">Tutti</span>}
                        </td>
                        <td className="mono">{fmtDate(m.created_at)}</td>
                        <td>
                          {m.role !== 'owner' && (
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn sm danger" onClick={() => { if (confirm(`Rimuovere ${m.email || 'questo membro'} dall’organizzazione? Perderà subito l’accesso.`)) rpc('wa_remove_member', { p_org: org.id, p_user: m.user_id }, 'Membro rimosso') }}>Rimuovi</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="card flush">
          <div className="pane-head"><span className="section-label">{isOrgAdmin ? 'Inviti in sospeso' : 'I tuoi inviti in sospeso'}{pending.length ? ` (${pending.length})` : ''}</span></div>
          {invites === null ? <Spinner /> : pending.length === 0 ? (
            <EmptyState icon="people" title="Nessun invito in sospeso">Gli inviti non ancora accettati compaiono qui, con la scadenza del link.</EmptyState>
          ) : (
            <table className="table">
              <thead><tr><th>Email</th><th>Ruolo</th><th>Clienti</th><th>Scade</th><th></th></tr></thead>
              <tbody>
                {pending.map((i) => {
                  const expired = new Date(i.expires_at) <= new Date()
                  return (
                    <tr key={i.id}>
                      <td style={{ fontWeight: 600, color: 'var(--heading)' }}>{i.email}</td>
                      <td>{ROLE_LABEL[i.role]}</td>
                      <td className="small secondary">{i.role === 'admin' ? 'Tutti' : (i.client_ids || []).map((id) => clientName[id]).filter(Boolean).join(', ') || '–'}</td>
                      <td>{expired ? <span className="badge red">Scaduto</span> : <span className="mono">{fmtDateTime(i.expires_at)}</span>}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <button className="btn sm" onClick={() => renew(i)}>Nuovo link</button>
                          <button className="btn sm danger" onClick={() => rpc('wa_revoke_invite', { p_invite: i.id }, 'Invito revocato')}>Revoca</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="hint" style={{ padding: '0 18px 14px' }}>Per sicurezza il link si vede solo quando lo crei: se l’hai perso, genera un nuovo link (quello vecchio smette di funzionare).</div>
        </div>

        {isOrgAdmin && (
          <div className="card">
            <div className="card-title">Organizzazione</div>
            <div className="grid2">
              <div className="field">
                <label className="label" htmlFor="org-name">Nome</label>
                <div className="row"><input id="org-name" className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                  <button className="btn" disabled={!orgName.trim() || orgName.trim() === org.name} onClick={saveOrgName}>Salva</button></div>
              </div>
              <div className="field">
                <span className="label">Piano</span>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="badge green">{org.plan}</span>
                  <span className="small secondary">
                    Clienti: {limits.clients ?? 'illimitati'} · Membri: {limits.members ?? 'illimitati'} · Messaggi al mese: {limits.messages_per_month ?? 'illimitati'}
                  </span>
                </div>
                <div className="hint">Piano e limiti si gestiranno con i pagamenti; per ora si cambiano solo dal database.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} org={org} isOrgAdmin={isOrgAdmin} clients={clients} setToast={setToast}
        onCreated={(inv, email) => { setInviteOpen(false); load(); showLink(inv, email) }} />
      <AssignModal member={editAssign} onClose={() => setEditAssign(null)} clients={clients} current={editAssign ? assignedTo(editAssign.user_id) : []}
        onSave={async (ids) => { await rpc('wa_set_client_assignments', { p_org: org.id, p_user: editAssign.user_id, p_client_ids: ids }, 'Clienti aggiornati'); setEditAssign(null) }} />
      <LinkModal link={link} onClose={() => setLink(null)} setToast={setToast} />
    </div>
  )
}

function ClientChecklist({ clients, value, onChange }) {
  const set = new Set(value)
  if (!clients.length) return <div className="hint">Nessun cliente disponibile.</div>
  return (
    <div className="table-wrap" style={{ maxHeight: 240, padding: 6 }}>
      {clients.map((c) => (
        <label key={c.id} className="row" style={{ gap: 10, padding: '7px 8px', cursor: 'pointer', borderRadius: 8 }}>
          <input type="checkbox" className="checkbox" checked={set.has(c.id)} onChange={() => { set.has(c.id) ? set.delete(c.id) : set.add(c.id); onChange([...set]) }} />
          <span>{c.name}</span>
        </label>
      ))}
    </div>
  )
}

function InviteModal({ open, onClose, org, isOrgAdmin, clients, onCreated, setToast }) {
  const [f, setF] = useState({ email: '', role: 'collaborator', clients: [], days: 7 })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setF({ email: '', role: 'collaborator', clients: [], days: 7 }) }, [open])
  const submit = async (e) => {
    e.preventDefault()
    if (f.role === 'collaborator' && !f.clients.length) return setToast('Scegli almeno un cliente')
    setBusy(true)
    const { data, error } = await supabase.rpc('wa_create_invite', { p_org: org.id, p_email: f.email.trim(), p_role: f.role, p_client_ids: f.role === 'admin' ? [] : f.clients, p_days: Number(f.days) })
    setBusy(false)
    if (error) return setToast(errMsg(error))
    onCreated(data, f.email.trim().toLowerCase())
  }
  return (
    <Modal open={open} title={isOrgAdmin ? 'Invita nel team' : 'Invita un collaboratore'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="inv-email">Email</label>
          <input id="inv-email" className="input" type="email" required autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nome@azienda.it" />
          <div className="hint">La persona dovrà accedere (o registrarsi) con questo indirizzo.</div></div>
        {isOrgAdmin && (
          <div className="field"><span className="label">Ruolo</span>
            <div className="tabs" role="radiogroup" aria-label="Ruolo">
              {[['collaborator', 'Collaboratore'], ['admin', 'Admin']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={f.role === k} className={`tab ${f.role === k ? 'active' : ''}`} onClick={() => setF({ ...f, role: k })}>{l}</button>
              ))}
            </div>
            <div className="hint">{f.role === 'admin' ? 'Un admin vede e gestisce tutti i clienti e il team.' : 'Un collaboratore vede e usa solo i clienti che scegli qui sotto.'}</div>
          </div>
        )}
        {f.role === 'collaborator' && (
          <div className="field"><span className="label">Clienti</span>
            <ClientChecklist clients={clients} value={f.clients} onChange={(ids) => setF({ ...f, clients: ids })} />
            {!isOrgAdmin && <div className="hint">Puoi scegliere solo tra i clienti assegnati a te.</div>}
          </div>
        )}
        <div className="field"><label className="label" htmlFor="inv-days">Il link scade dopo</label>
          <select id="inv-days" className="select" style={{ maxWidth: 200 }} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
            <option value={1}>1 giorno</option><option value={3}>3 giorni</option><option value={7}>7 giorni</option><option value={14}>14 giorni</option><option value={30}>30 giorni</option>
          </select></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Annulla</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Creazione…' : 'Crea invito'}</button>
        </div>
      </form>
    </Modal>
  )
}

function AssignModal({ member, onClose, clients, current, onSave }) {
  const [ids, setIds] = useState(current)
  useEffect(() => { setIds(current) }, [member?.user_id])
  return (
    <Modal open={!!member} title={`Clienti di ${member?.email || ''}`} onClose={onClose}>
      <ClientChecklist clients={clients} value={ids} onChange={setIds} />
      <div className="hint">Il collaboratore vede solo questi clienti: conversazioni, knowledge, impostazioni e report.</div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={() => onSave(ids)}>Salva</button>
      </div>
    </Modal>
  )
}

function LinkModal({ link, onClose, setToast }) {
  if (!link) return null
  const url = inviteLink(link.token)
  const copy = async () => { try { await navigator.clipboard.writeText(url); setToast('Link copiato') } catch { setToast('Copia non riuscita: seleziona il link e copialo') } }
  return (
    <Modal open title="Invito pronto" onClose={onClose}>
      <p className="secondary" style={{ marginTop: 0 }}>Manda questo link a <b style={{ color: 'var(--heading)' }}>{link.email}</b>. Vale una sola volta e solo per quell’indirizzo.</p>
      <div className="code" style={{ userSelect: 'all' }}>{url}</div>
      <div className="row between wrap" style={{ marginTop: 14 }}>
        <span className="small secondary" aria-live="polite">
          {link.emailed === null ? 'Invio email…' : link.emailed === 'sent' ? 'Email inviata.' : 'Email non inviata (servizio email non configurato): copia il link.'}
        </span>
        <button className="btn primary" onClick={copy}>Copia link</button>
      </div>
    </Modal>
  )
}
