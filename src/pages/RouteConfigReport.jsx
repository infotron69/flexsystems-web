import { useEffect, useState } from 'react';
import { getSites, getRoutes, getAllRoutePoints } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import { downloadCsv } from '../utils/exportCsv';
import styles from './Report.module.css';

export default function RouteConfigReport() {
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [pointsByRoute, setPointsByRoute] = useState({});
  const [siteId, setSiteId] = useState('');
  const [routeId, setRouteId] = useState('');

  useEffect(() => {
    // A tenant can have well over a hundred routes -- one bulk request
    // grouped by route_id replaces what used to be one request per route.
    Promise.all([getSites(), getRoutes(), getAllRoutePoints()])
      .then(([s, r, byRoute]) => {
        setSites(s);
        setRoutes(r);
        setPointsByRoute(byRoute);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  function handleExport() {
    const headers = ['Site', 'Site Code', 'Route Name', 'Route Code', 'Template', 'Point Code', 'Description', 'Tag', 'Patrol Type', 'Frequency'];
    const rows = sites
      .filter(s => !siteId || s.id === siteId)
      .flatMap(site => routes.filter(r => r.site_id === site.id && (!routeId || r.id === routeId)).flatMap(route => {
        const pts = pointsByRoute[route.id] ?? [];
        const templateFlag = route.is_template ? 'Y' : 'N';
        if (pts.length === 0) {
          return [[site.name, site.site_code, route.name, route.route_code, templateFlag, '', '', '', '', '']];
        }
        return pts.map(ap => [
          site.name, site.site_code, route.name, route.route_code, templateFlag,
          ap.point?.point_code || '', ap.point?.description || '', ap.point?.tag_type || '',
          ap.patrol_type || '', ap.frequency || '',
        ]);
      }));
    downloadCsv('route-setup', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Route Setup" subtitle="Routes and their allocated points" backTo="/setup/reports" onExport={handleExport} />
      <div className={styles.meta}>Generated {now}</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Site</label>
          <select className={styles.filterSelect} value={siteId} onChange={e => { setSiteId(e.target.value); setRouteId(''); }}>
            <option value="">All Sites</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Route</label>
          <select className={styles.filterSelect} value={routeId} onChange={e => setRouteId(e.target.value)}>
            <option value="">All Routes</option>
            {routes.filter(r => !siteId || r.site_id === siteId).map(r => <option key={r.id} value={r.id}>{r.name} — {r.route_code}</option>)}
          </select>
        </div>
      </div>

      {sites.filter(s => !siteId || s.id === siteId).map(site => {
        const siteRoutes = routes.filter(r => r.site_id === site.id && (!routeId || r.id === routeId));
        if (siteRoutes.length === 0) return null;
        return (
          <div className={styles.section} key={site.id}>
            <h3 className={styles.sectionTitle}>{site.name} ({site.site_code})</h3>
            {siteRoutes.map(route => {
              const pts = pointsByRoute[route.id] ?? [];
              return (
                <div key={route.id} style={{ marginBottom: 16 }}>
                  <div className={styles.subTitle}>
                    {route.name} — {route.route_code}
                    {route.is_template && ' (Template)'}
                    <span className={styles.countBadge}>{pts.length} point{pts.length !== 1 ? 's' : ''}</span>
                  </div>
                  {pts.length === 0 ? (
                    <div className={styles.empty}>No points assigned</div>
                  ) : (
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Point Code</th><th>Description</th><th>Tag</th><th>Patrol Type</th><th>Frequency</th></tr>
                      </thead>
                      <tbody>
                        {pts.map(ap => (
                          <tr key={ap.point_id}>
                            <td>{ap.point?.point_code}</td>
                            <td>{ap.point?.description}</td>
                            <td>{ap.point?.tag_type || '—'}</td>
                            <td>{ap.patrol_type || '—'}</td>
                            <td>{ap.frequency || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <ReportFooter />
    </div>
  );
}
