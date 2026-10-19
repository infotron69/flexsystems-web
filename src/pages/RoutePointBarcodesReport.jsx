import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { getSites, getRoutes, getAllRoutePoints } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import Barcode128 from '../components/Barcode128';
import FindSortBar from '../components/FindSortBar';
import { useFindSort, matchesFind, findAndSort } from '../utils/reportView';
import styles from './Report.module.css';

const SORT_OPTIONS = [
  { key: 'point_code', label: 'Point Code' },
  { key: 'description', label: 'Description' },
  { key: 'location', label: 'Location' },
];

const sortValue = (ap, key) => ({
  point_code: ap.point?.point_code, description: ap.point?.description, location: ap.point?.location,
})[key];

export default function RoutePointBarcodesReport() {
  const view = useFindSort('point_code');
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [pointsByRoute, setPointsByRoute] = useState({});
  const [qrByPointCode, setQrByPointCode] = useState({});
  const [siteId, setSiteId] = useState('');
  const [routeId, setRouteId] = useState('');

  useEffect(() => {
    Promise.all([getSites(), getRoutes(), getAllRoutePoints()])
      .then(async ([s, r, byRoute]) => {
        setSites(s);
        setRoutes(r);
        setPointsByRoute(byRoute);

        // Same code the barcode already encodes - a device scans whichever
        // symbology is posted at the checkpoint, so both are generated for
        // every point rather than picking one up front.
        const codes = [...new Set(
          Object.values(byRoute).flatMap(pts => pts.map(ap => ap.point?.point_code)).filter(Boolean)
        )];
        const qrEntries = await Promise.all(
          codes.map(code => QRCode.toDataURL(code, { width: 64, margin: 1 }).then(url => [code, url]))
        );
        setQrByPointCode(Object.fromEntries(qrEntries));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  // A route whose own name/code matches Find keeps all its points; otherwise
  // only matching points are shown, and a route with none is hidden.
  function viewRoute(route) {
    const all = pointsByRoute[route.id] ?? [];
    const routeMatch = matchesFind(view.find, route.name, route.route_code);
    const pts = findAndSort(
      all, view,
      ap => [ap.point?.point_code, ap.point?.description, ap.point?.location],
      sortValue, routeMatch,
    );
    const show = !view.find.trim() || routeMatch || pts.length > 0;
    return { all, pts, show };
  }

  const visibleRoutes = routes.filter(r =>
    (!siteId || r.site_id === siteId) && (!routeId || r.id === routeId) && viewRoute(r).show);

  return (
    <div className={`${styles.page} ${styles.allowPageBreak}`}>
      <ReportHeader title="Route Point Barcodes" subtitle="Route detail with a scannable barcode for each point's code" />
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
        <FindSortBar
          find={view.find} onFind={view.setFind} placeholder="Route, point, location…"
          sortKey={view.sortKey} onSortKey={view.setSortKey}
          sortDir={view.sortDir} onSortDir={view.setSortDir}
          sortOptions={SORT_OPTIONS}
        />
      </div>

      {sites.filter(s => !siteId || s.id === siteId).map(site => {
        const siteRoutes = visibleRoutes.filter(r => r.site_id === site.id);
        if (siteRoutes.length === 0) return null;
        return (
          <div className={styles.section} key={site.id}>
            <h3 className={styles.sectionTitle}>{site.name} ({site.site_code})</h3>
            {siteRoutes.map(route => {
              const { all, pts } = viewRoute(route);
              return (
                <div key={route.id} style={{ marginBottom: 24 }}>
                  <div className={styles.subTitle}>
                    {route.name} — {route.route_code}
                    {route.is_template && ' (Template)'}
                    <span className={styles.countBadge}>
                      {pts.length !== all.length ? `${pts.length} of ${all.length}` : pts.length} point{all.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {pts.length === 0 ? (
                    <div className={styles.empty}>{all.length === 0 ? 'No points assigned' : 'No points match'}</div>
                  ) : (
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Point Code</th><th>Description</th><th>Location</th><th>Barcode</th><th>QR Code</th></tr>
                      </thead>
                      <tbody>
                        {pts.map((ap, i) => (
                          <tr key={ap.point_id}>
                            <td>{ap.point?.point_code}</td>
                            <td>{ap.point?.description}</td>
                            <td>{ap.point?.location || '—'}</td>
                            {/* Alternating left/right per row so a guard scanning down a
                                printed sheet doesn't cross into the barcode on the row
                                above/below — each one sits in a distinct horizontal lane. */}
                            <td style={{ textAlign: i % 2 === 0 ? 'left' : 'right' }}>
                              {ap.point?.point_code
                                ? <Barcode128 value={ap.point.point_code} moduleWidth={1} height={18} quietZone={6} showText={false} />
                                : '—'}
                            </td>
                            <td style={{ textAlign: i % 2 === 0 ? 'left' : 'right' }}>
                              {ap.point?.point_code && qrByPointCode[ap.point.point_code]
                                ? <img src={qrByPointCode[ap.point.point_code]} alt={`QR code for ${ap.point.point_code}`} width={40} height={40} />
                                : '—'}
                            </td>
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
