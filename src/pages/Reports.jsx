import { useNavigate } from 'react-router-dom';
import styles from './SetupMenu.module.css';

// Matches the legacy Tbl_Report_Names "PDA" report group (Report_Type 2) —
// operational/transaction reports. Configuration reports (Report_Type 3)
// live under Setup → Configuration Reports instead.
const REPORTS = [
  { label: 'Patrol Report',             sub: 'Transaction history — sortable, filterable',      to: '/reports/transactions' },
  { label: 'GPS Map',                   sub: 'GPS-tagged scans plotted on a map, with full data table', to: '/reports/gps-map' },
  { label: 'Performance Metrics',       sub: 'Points scanned/passed/failed/missed per route, with chart', to: '/reports/performance' },
];

export default function Reports() {
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Reports</h2>
      <div className={styles.grid}>
        {REPORTS.map(item => (
          <button
            key={item.to}
            className={styles.tile}
            onClick={() => navigate(item.to)}
          >
            <span className={styles.tileLabel}>{item.label}</span>
            <span className={styles.tileSub}>{item.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
