import { Fragment, useMemo, useState } from 'react';
import styles from '../pages/Report.module.css';

// Renders a transaction list as sortable columns, grouped into
// Customer -> Site -> Route header bands with the actual rows nested
// underneath each route (mirrors the Patrol Report's layout). `renderRow`
// must return an element (with its own key) for a single transaction row —
// e.g. one <tr>, or a <Fragment> containing a main row plus a detail row.
export default function GroupedTransactionTable({
  rows,
  columns,
  renderRow,
  customersById,
  sitesById,
  routesById,
  defaultSortKey = 'trans_date',
  defaultSortDir = 'desc',
  emptyMessage = 'No transactions match these filters',
  renderRouteExtra,
  onRouteClick,
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState(defaultSortDir);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const grouped = useMemo(() => {
    const custMap = new Map();
    for (const r of sorted) {
      const custCode = r.customer_code || '—';
      const siteCode = r.site_code || '—';
      const routeCode = r.route_id || '—';
      if (!custMap.has(custCode)) {
        custMap.set(custCode, { name: customersById.get(custCode)?.name || custCode, sites: new Map() });
      }
      const cust = custMap.get(custCode);
      if (!cust.sites.has(siteCode)) {
        cust.sites.set(siteCode, { name: sitesById.get(siteCode)?.name || siteCode, routes: new Map() });
      }
      const site = cust.sites.get(siteCode);
      if (!site.routes.has(routeCode)) {
        site.routes.set(routeCode, { name: routesById.get(routeCode)?.name || routeCode, rows: [] });
      }
      site.routes.get(routeCode).rows.push(r);
    }
    return [...custMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [sorted, customersById, sitesById, routesById]);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col.key} className={styles.sortHeader} onClick={() => toggleSort(col.key)}>
              {col.label}
              {sortKey === col.key && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grouped.map(([custCode, cust]) => (
          <Fragment key={custCode}>
            <tr className={styles.groupHeaderCustomer}>
              <td colSpan={columns.length}>{cust.name}</td>
            </tr>
            {[...cust.sites.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([siteCode, site]) => (
              <Fragment key={siteCode}>
                <tr className={styles.groupHeaderSite}>
                  <td colSpan={columns.length}>{site.name}</td>
                </tr>
                {[...site.routes.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([routeCode, route]) => (
                  <Fragment key={routeCode}>
                    <tr className={styles.groupHeaderRoute}>
                      <td colSpan={columns.length}>
                        {onRouteClick ? (
                          <button className={styles.routeNameBtn} onClick={() => onRouteClick(routeCode)} title="Open this route in the Inspection Report">
                            {route.name}
                          </button>
                        ) : route.name}
                      </td>
                    </tr>
                    {renderRouteExtra && (
                      <tr>
                        <td colSpan={columns.length} className={styles.routeExtraCell}>
                          {renderRouteExtra(routeCode)}
                        </td>
                      </tr>
                    )}
                    {route.rows.map(r => renderRow(r))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </Fragment>
        ))}
        {sorted.length === 0 && (
          <tr><td colSpan={columns.length} className={styles.empty}>{emptyMessage}</td></tr>
        )}
      </tbody>
    </table>
  );
}
