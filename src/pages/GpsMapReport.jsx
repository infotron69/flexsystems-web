import { useEffect, useState, useMemo } from 'react';
import { getTransactions, getRoutes, getCustomers, getSites } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import GpsMapView from '../components/GpsMapView';
import GroupedTransactionTable from '../components/GroupedTransactionTable';
import styles from './Report.module.css';

function rowMs(r) {
  const dateStr = r.trans_date ? r.trans_date.slice(0, 10) : null;
  const timeStr = r.trans_time ? r.trans_time.slice(11, 19) : null;
  return dateStr && timeStr ? new Date(`${dateStr}T${timeStr}`).getTime() : null;
}

// Mirrors TransactionReport.jsx's mergeContinuationRows: without this, a
// multi-part visit (e.g. a failed asset sub-scan) plots as separate pins —
// one per sub-row, each with its own individual (and possibly disagreeing)
// Pass/Fail — instead of one pin showing the merged Fail-wins result that
// the rest of the app reports for that same visit.
const MERGE_WINDOW_MS = 60 * 1000;

function mergeContinuationRows(rows) {
  const chron = [...rows].sort((a, b) => (rowMs(a) ?? 0) - (rowMs(b) ?? 0));
  const groups = [];
  let current = null;
  for (const r of chron) {
    const ms = rowMs(r);
    const last = current ? current[current.length - 1] : null;
    const lastMs = last ? rowMs(last) : null;
    const joinsCurrent = current &&
      r.route_id === current[0].route_id &&
      r.point_id === current[0].point_id &&
      ms != null && lastMs != null && (ms - lastMs) <= MERGE_WINDOW_MS;
    if (joinsCurrent) {
      current.push(r);
    } else {
      if (current) groups.push(current);
      current = [r];
    }
  }
  if (current) groups.push(current);

  return groups.map(group => {
    const first = group[0];
    const last = group[group.length - 1];
    const anyFail = group.some(r => r.inspection_result === 'N');
    const anyMissed = group.some(r => r.missed_point === 'Y');
    const anyPass = group.some(r => r.inspection_result === 'Y');
    const assetIds = [...new Set(group.map(r => r.asset_id).filter(Boolean))];
    // A GPS fix may land on any sub-row of the visit, not necessarily the
    // first -- don't silently drop the pin because the merge picked a
    // different sub-row as its base.
    const gpsRow = group.find(r => Number.isFinite(r.gps_lat) && Number.isFinite(r.gps_lng));
    return {
      ...first,
      id: group.length > 1 ? `${first.id}-${last.id}` : first.id,
      asset_id: assetIds.length > 0 ? assetIds.join(', ') : first.asset_id,
      inspection_result: anyFail ? 'N' : anyPass ? 'Y' : first.inspection_result,
      missed_point: !anyFail && anyMissed ? 'Y' : 'N',
      gps_lat: gpsRow?.gps_lat,
      gps_lng: gpsRow?.gps_lng,
      _subRows: group,
    };
  });
}

const COLUMNS = [
  { key: 'id',                 label: 'ID' },
  { key: 'inspection_result', label: 'Result' },
  { key: 'asset_id',          label: 'Asset' },
  { key: 'point_id',          label: 'Point ID' },
  { key: 'point_desc',        label: 'Point' },
  { key: 'trans_date',        label: 'Date' },
  { key: 'trans_time',        label: 'Time' },
  { key: 'guard',             label: 'Operator' },
  { key: 'missed_point',      label: 'Missed' },
  { key: 'gps',                label: 'GPS' },
];

function GpsRow({ r }) {
  return (
    <tr>
      <td>{r.id}</td>
      <td>{r.missed_point === 'Y' ? 'Missed' : r.inspection_result === 'Y' ? 'Pass' : r.inspection_result === 'N' ? 'Fail' : '—'}</td>
      <td>{r.asset_id || '—'}</td>
      <td>{r.point_id || '—'}</td>
      <td>{r.point_desc || '—'}</td>
      <td>{r.trans_date ? r.trans_date.slice(0, 10) : '—'}</td>
      <td>{r.trans_time ? r.trans_time.slice(11, 16) : '—'}</td>
      <td>{r.guard || '—'}</td>
      <td>{r.missed_point === 'Y' ? 'Y' : ''}</td>
      <td>
        <a href={`https://maps.google.com/?q=${r.gps_lat},${r.gps_lng}`} target="_blank" rel="noreferrer">
          {r.gps_lat.toFixed(6)}, {r.gps_lng.toFixed(6)}
        </a>
      </td>
    </tr>
  );
}

export default function GpsMapReport() {
  const [rows, setRows] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);

  const [routeId, setRouteId] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [missedFilter, setMissedFilter] = useState('');
  const [pointFilter, setPointFilter] = useState('');

  useEffect(() => {
    Promise.all([
      getTransactions({ gps_only: true }),
      getRoutes(),
      getCustomers(),
      getSites(),
    ]).then(([txns, r, custs, sts]) => {
      setRows(txns);
      setRoutes(r);
      setCustomers(custs);
      setSites(sts);
    }).finally(() => setLoading(false));
  }, []);

  const routesById = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes]);
  const customersById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const sitesById = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites]);

  const assetOptions = useMemo(() => [...new Set(rows.map(r => r.asset_id).filter(Boolean))].sort(), [rows]);
  const pointOptions = useMemo(() => {
    const map = new Map();
    rows.forEach(r => { if (r.point_id && !map.has(r.point_id)) map.set(r.point_id, r.point_desc || r.point_id); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const preFiltered = rows.filter(r =>
      (!routeId || r.route_id === routeId) &&
      (!resultFilter || r.inspection_result === resultFilter) &&
      (!assetFilter || r.asset_id === assetFilter) &&
      (!missedFilter || r.missed_point === missedFilter) &&
      (!pointFilter || r.point_id === pointFilter)
    );
    return mergeContinuationRows(preFiltered).filter(r => Number.isFinite(r.gps_lat) && Number.isFinite(r.gps_lng));
  }, [rows, routeId, resultFilter, assetFilter, missedFilter, pointFilter]);

  function clearFilters() {
    setRouteId(''); setResultFilter(''); setAssetFilter(''); setMissedFilter(''); setPointFilter('');
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  return (
    <div className={styles.page}>
      <ReportHeader title="GPS Map" subtitle="Operator scan locations plotted on a map" />
      <div className={styles.meta}>Generated {now} — {filtered.length} of {rows.length} GPS-tagged scans</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Route</label>
          <select className={styles.filterSelect} value={routeId} onChange={e => setRouteId(e.target.value)}>
            <option value="">All Routes</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name} — {r.route_code}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Result</label>
          <select className={styles.filterSelect} value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
            <option value="">All Results</option>
            <option value="Y">Pass</option>
            <option value="N">Fail</option>
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Asset</label>
          <select className={styles.filterSelect} value={assetFilter} onChange={e => setAssetFilter(e.target.value)}>
            <option value="">All Assets</option>
            {assetOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Missed</label>
          <select className={styles.filterSelect} value={missedFilter} onChange={e => setMissedFilter(e.target.value)}>
            <option value="">All</option>
            <option value="Y">Missed Only</option>
            <option value="N">Not Missed</option>
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Point</label>
          <select className={styles.filterSelect} value={pointFilter} onChange={e => setPointFilter(e.target.value)}>
            <option value="">All Points</option>
            {pointOptions.map(([id, desc]) => <option key={id} value={id}>{desc}</option>)}
          </select>
        </div>
        <button className={styles.clearBtn} onClick={clearFilters}>Clear</button>
      </div>

      <div className={styles.section}>
        <GpsMapView rows={filtered} height={480} />
        {filtered.length === 0 && (
          <div className={styles.empty}>No GPS-tagged scans match these filters</div>
        )}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: '0.82rem', color: '#555' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#16a34a', marginRight: 6 }} />Pass</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#dc2626', marginRight: 6 }} />Fail</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#9ca3af', marginRight: 6 }} />No result</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#f97316', marginRight: 6 }} />Missed</span>
          </div>
        )}
      </div>

      {filtered.length > 0 && (
        <div className={styles.section}>
          <GroupedTransactionTable
            rows={filtered}
            columns={COLUMNS}
            renderRow={r => <GpsRow key={r.id} r={r} />}
            customersById={customersById}
            sitesById={sitesById}
            routesById={routesById}
            emptyMessage="No GPS-tagged scans match these filters"
          />
        </div>
      )}
      <ReportFooter />
    </div>
  );
}
