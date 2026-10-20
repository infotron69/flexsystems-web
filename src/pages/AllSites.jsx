import { useEffect, useMemo, useState } from 'react';
import { getAllSites } from '../api/client';
import FindSortBar from '../components/FindSortBar';
import { useFindSort, matchesFind, compareValues } from '../utils/reportView';
import styles from './Report.module.css';

const SORT_OPTIONS = [
  { key: 'tenant', label: 'Customer' },
  { key: 'site_code', label: 'Site Code' },
  { key: 'name', label: 'Site Name' },
  { key: 'routes', label: 'Routes' },
  { key: 'points', label: 'Points' },
];

// Flex-admin overview of every tenant's sites. Each tenant is its own
// database, so this reads them one by one (nothing is copied or merged);
// the data stays where it lives and is always current.
export default function AllSites() {
  const view = useFindSort('tenant');
  const [tenants, setTenants] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getAllSites()
      .then(setTenants)
      .catch(ex => setErr(ex.response?.status === 403 ? 'This list is only available to the Flex administrator.' : 'Could not load sites.'));
  }, []);

  const rows = useMemo(() => {
    if (!tenants) return [];
    const flat = tenants.flatMap(t => t.sites.map(s => ({ ...s, tenant: t.tenant_label, tenantId: t.tenant_id })));
    const sortVal = r => ({ tenant: r.tenant, site_code: r.site_code, name: r.name, routes: r.routes, points: r.points })[view.sortKey];
    return flat
      .filter(r => matchesFind(view.find, r.tenant, r.site_code, r.name, r.city, r.state))
      .sort((a, b) => compareValues(sortVal(a), sortVal(b), view.sortDir) || compareValues(a.site_code, b.site_code));
  }, [tenants, view.find, view.sortKey, view.sortDir]);

  if (err) return <div className={styles.page}><div className={styles.empty}>{err}</div></div>;
  if (!tenants) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const total = tenants.reduce((n, t) => n + t.sites.length, 0);
  const broken = tenants.filter(t => t.error);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headingBlock}>
          <div className={styles.headingRow}><h2 className={styles.heading}>All Sites</h2></div>
          <span className={styles.subheading}>Every customer's sites, read-only</span>
        </div>
      </div>
      <div className={styles.meta}>
        {rows.length} of {total} sites across {tenants.length} customers
        {broken.length > 0 && <> — <strong className={styles.unusedMeta}>{broken.length} database{broken.length === 1 ? '' : 's'} could not be read</strong></>}
      </div>

      <div className={styles.filterBar}>
        <FindSortBar
          find={view.find} onFind={view.setFind} placeholder="Customer, site, city…"
          sortKey={view.sortKey} onSortKey={view.setSortKey}
          sortDir={view.sortDir} onSortDir={view.setSortDir}
          sortOptions={SORT_OPTIONS}
        />
      </div>

      <div className={styles.section}>
        <table className={styles.table}>
          <thead>
            <tr><th>Customer</th><th>Site Code</th><th>Site Name</th><th>City / State</th><th>Routes</th><th>Points</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.tenantId}:${r.site_code}`}>
                <td>{r.tenant}</td>
                <td>{r.site_code}</td>
                <td>{r.name}</td>
                <td>{r.city ? `${r.city}${r.state ? ', ' + r.state : ''}` : '—'}</td>
                <td>{r.routes}</td>
                <td>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className={styles.empty}>No sites match.</div>}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Customers</h3>
        <table className={styles.table}>
          <thead><tr><th>Customer</th><th>Database</th><th>Sites</th><th>Last transaction</th></tr></thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.tenant_id}>
                <td>{t.tenant_label}</td>
                <td>{t.database}</td>
                <td>{t.error ? <span className={styles.unusedMeta}>unreadable: {t.error}</span> : t.sites.length}</td>
                <td>{t.last_activity ? new Date(t.last_activity).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
