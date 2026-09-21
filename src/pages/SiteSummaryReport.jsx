import { useEffect, useState } from 'react';
import { getCustomers, getSites, getRoutes, getPoints, getGuards, getAllQuestions } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import { downloadCsv } from '../utils/exportCsv';
import styles from './Report.module.css';

export default function SiteSummaryReport() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [points, setPoints] = useState([]);
  const [guardCount, setGuardCount] = useState(0);
  const [questionCount, setQuestionCount] = useState(0);
  const [customerId, setCustomerId] = useState('');

  useEffect(() => {
    Promise.all([getCustomers(), getSites(), getRoutes(), getPoints(), getGuards(), getAllQuestions()])
      .then(([c, s, r, p, g, q]) => {
        setCustomers(c); setSites(s); setRoutes(r); setPoints(p);
        setGuardCount(g.length); setQuestionCount(q.length);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  function handleExport() {
    const headers = ['Customer', 'Site Code', 'Site Name', 'City', 'State', 'Routes', 'Points'];
    const rows = customers
      .filter(c => !customerId || c.id === customerId)
      .flatMap(cust => sites.filter(s => s.customer_id === cust.id).map(s => [
        cust.name, s.site_code, s.name, s.city || '', s.state || '',
        routes.filter(r => r.site_id === s.id).length,
        points.filter(p => p.site_id === s.id).length,
      ]));
    downloadCsv('site-summary', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Site Summary" subtitle="Configuration report" backTo="/setup/reports" onExport={handleExport} />
      <div className={styles.meta}>Generated {now}</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Customer</label>
          <select className={styles.filterSelect} value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.grid}>
          <div className={styles.statCard}><div className={styles.statValue}>{customers.length}</div><div className={styles.statLabel}>Customers</div></div>
          <div className={styles.statCard}><div className={styles.statValue}>{sites.length}</div><div className={styles.statLabel}>Sites</div></div>
          <div className={styles.statCard}><div className={styles.statValue}>{routes.length}</div><div className={styles.statLabel}>Routes</div></div>
          <div className={styles.statCard}><div className={styles.statValue}>{points.length}</div><div className={styles.statLabel}>Points</div></div>
          <div className={styles.statCard}><div className={styles.statValue}>{guardCount}</div><div className={styles.statLabel}>Operators</div></div>
          <div className={styles.statCard}><div className={styles.statValue}>{questionCount}</div><div className={styles.statLabel}>Questions</div></div>
        </div>
      </div>

      {customers.filter(c => !customerId || c.id === customerId).map(cust => {
        const custSites = sites.filter(s => s.customer_id === cust.id);
        return (
          <div className={styles.section} key={cust.id}>
            <h3 className={styles.sectionTitle}>
              {cust.name} <span className={styles.countBadge}>{custSites.length} site{custSites.length !== 1 ? 's' : ''}</span>
            </h3>
            {custSites.length === 0 ? (
              <div className={styles.empty}>No sites for this customer</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Site Code</th><th>Site Name</th><th>City / State</th>
                    <th>Routes</th><th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {custSites.map(s => {
                    const siteRoutes = routes.filter(r => r.site_id === s.id);
                    const sitePoints = points.filter(p => p.site_id === s.id);
                    return (
                      <tr key={s.id}>
                        <td>{s.site_code}</td>
                        <td>{s.name}</td>
                        <td>{s.city ? `${s.city}${s.state ? ', ' + s.state : ''}` : '—'}</td>
                        <td>{siteRoutes.length}</td>
                        <td>{sitePoints.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <ReportFooter />
    </div>
  );
}
