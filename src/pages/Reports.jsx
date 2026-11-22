import ReportsView from '../components/ReportsView'
export default function Reports() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Report</h1>
          <p className="lead" style={{ margin: '6px 0 0' }}>Bozze generate in base alla cadenza di ogni cliente. Rileggile, modificale e inviale.</p>
        </div>
      </div>
      <ReportsView />
    </div>
  )
}
