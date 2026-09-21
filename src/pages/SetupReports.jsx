import { useNavigate } from 'react-router-dom';
import styles from './SetupMenu.module.css';

// Matches the legacy Tbl_Report_Names "Configuration" report group (Report_Type 3).
const REPORTS = [
  { label: 'Site Summary',              sub: 'Customers, sites, route & point counts',        to: '/setup/reports/site-summary' },
  { label: 'Route Setup',               sub: 'Routes and their allocated points',              to: '/setup/reports/routes' },
  { label: 'Point Barcode Labels',      sub: 'Route detail with a scannable barcode per point', to: '/setup/reports/point-barcodes' },
  { label: 'Route Setup w/ Questions',  sub: 'Routes, points, and assigned questions',         to: '/setup/reports/route-questions' },
  { label: 'Questions Setup',           sub: 'Full question library',                          to: '/setup/reports/questions' },
  { label: 'Operator Setup',            sub: 'Operator roster',                                to: '/setup/reports/operators' },
  { label: 'Incident/Activity',         sub: 'Incident type hierarchy',                        to: '/setup/reports/incidents' },
  { label: 'SOP Maintenance',           sub: 'SOP checklists and which incident uses each one', to: '/setup/reports/sops' },
];

export default function SetupReports() {
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Configuration Reports</h2>
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
