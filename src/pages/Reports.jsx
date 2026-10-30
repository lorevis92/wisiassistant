import ReportsView from '../components/ReportsView'
export default function Reports() {
  return (
    <div className="page">
      <div style={{ marginBottom: 16 }}>
        <h1>Report</h1>
        <div className="secondary small" style={{ marginTop: 4 }}>Bozze generate automaticamente in base alla cadenza di ogni cliente. Modifica, approva e invia.</div>
      </div>
      <ReportsView />
    </div>
  )
}
