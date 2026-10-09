import { Fragment, useEffect, useState, useMemo } from 'react';
import client, { getTransactions, getCustomers, getSites, getRoutes, getAllRoutePoints, getPoints, getAllQuestions } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import styles from './Report.module.css';

// Same buckets/classification as PerformanceMetricsReport.jsx, just applied
// to an admin-chosen SET of points instead of one route's own point list --
// a point can be scanned on more than one route, so this deliberately keys
// off point_id alone rather than route_id|point_id, unlike that report.
const SEGMENTS = [
  { key: 'passed',     label: 'Points Scanned and Passed',    color: '#16a34a' },
  { key: 'failed',     label: 'Points Scanned and Failed',    color: '#dc2626' },
  { key: 'notScanned', label: 'Points Not Scanned',           color: '#eab308' },
  { key: 'noResult',   label: 'Points Scanned and No Result', color: '#facc15' },
];

function rowMs(r) {
  const dateStr = r.trans_date ? r.trans_date.slice(0, 10) : null;
  const timeStr = r.trans_time ? r.trans_time.slice(11, 19) : null;
  return dateStr && timeStr ? new Date(`${dateStr}T${timeStr}`).getTime() : null;
}

// The legacy PDA app can write more than one Tbl_Transaction_Asset row for a
// single physical point visit (a clone-jump continuation, or an embedded
// asset sub-scan) -- consecutive rows for the same route+point within this
// window are the same visit. See PerformanceMetricsReport.jsx/
// TransactionReport.jsx's identical mergeContinuationRows.
const MERGE_WINDOW_MS = 60 * 1000;

// Classifies each selected point into exactly one bucket over the date
// range (mirrors PerformanceMetricsReport.jsx's classifyRoutePoints, but
// merges continuations across EVERY route the point was scanned on, then
// aggregates by point_id alone -- a point visited via two different routes
// in range still counts as one point with one latest result, not two).
function classifyPoints(pointIds, txns) {
  const byPointRoute = new Map();
  for (const t of txns) {
    const key = `${t.route_id}|${t.point_id}`;
    if (!byPointRoute.has(key)) byPointRoute.set(key, []);
    byPointRoute.get(key).push(t);
  }

  const visitsByPoint = new Map(); // point_id -> merged visit[]
  for (const rows of byPointRoute.values()) {
    const chron = [...rows].sort((a, b) => (rowMs(a) ?? 0) - (rowMs(b) ?? 0));
    const groups = [];
    let current = null;
    for (const r of chron) {
      const ms = rowMs(r);
      const lastMs = current ? rowMs(current[current.length - 1]) : null;
      if (current && ms != null && lastMs != null && (ms - lastMs) <= MERGE_WINDOW_MS) {
        current.push(r);
      } else {
        if (current) groups.push(current);
        current = [r];
      }
    }
    if (current) groups.push(current);

    for (const group of groups) {
      const anyFail = group.some(r => r.inspection_result === 'N');
      const anyMissed = group.some(r => r.missed_point === 'Y');
      const anyPass = group.some(r => r.inspection_result === 'Y');
      const last = group[group.length - 1];
      const visits = visitsByPoint.get(last.point_id) ?? [];
      visits.push({
        ms: rowMs(last),
        missed_point: !anyFail && anyMissed ? 'Y' : 'N',
        inspection_result: anyFail ? 'N' : anyPass ? 'Y' : last.inspection_result,
      });
      visitsByPoint.set(last.point_id, visits);
    }
  }

  // Per-point status badge only (shown next to a point in the picker's
  // "selected" column) -- there's deliberately no aggregate rollup here
  // anymore (see the render function for why a single pie-chart bucket per
  // point doesn't suit this report the way it suits a single route's own
  // checklist).
  const perPoint = new Map(); // point_id -> 'passed' | 'failed' | 'notScanned' | 'noResult'
  for (const pointId of pointIds) {
    const visits = visitsByPoint.get(pointId) || [];
    let bucket;
    if (visits.length === 0) {
      bucket = 'notScanned';
    } else {
      // Reflects this point's status as of the END of the range (its
      // latest visit) -- a miss that a later visit actually caught and
      // resolved reads as resolved, not as a permanent black mark.
      const latest = [...visits].sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0)).at(-1);
      if (latest.missed_point === 'Y') bucket = 'notScanned';
      else if (latest.inspection_result === 'Y') bucket = 'passed';
      else if (latest.inspection_result === 'N') bucket = 'failed';
      else bucket = 'noResult';
    }
    perPoint.set(pointId, bucket);
  }
  return perPoint;
}

// Everything below (through TransactionDetailTable) is the same copy every
// report page in this codebase keeps of Dashboard.jsx's Recent Activity
// rendering (continuation-merge, exception, photo/GPS rules) -- kept as its
// own copy per this codebase's established pattern for report pages, rather
// than a shared import.
const QA_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SENTINEL_QUESTION_IDS = new Set([349]);

function resolveMultichoiceAnswer(question, answer) {
  if (!question || question.question_type !== '2') return answer;
  const idx = parseInt(answer, 10);
  if (Number.isNaN(idx)) return answer;
  const options = [question.option1, question.option2, question.option3, question.option4, question.option5];
  return options[idx - 1] || answer;
}

function isOutOfRange(question, answer) {
  if (!question || question.question_type !== '4') return false;
  const value = parseFloat(answer);
  if (Number.isNaN(value)) return false;
  if (question.low_alarm && value < parseFloat(question.low_alarm)) return true;
  if (question.high_alarm && value > parseFloat(question.high_alarm)) return true;
  return false;
}

function answeredPairs(row, questionsById) {
  return QA_SLOTS
    .map(i => ({ qid: row[`question_id${i}`], answer: row[`answer${i}`], defaultResponse: row[`default_response${i}`] }))
    .filter(p => p.qid != null && p.answer != null && p.answer !== '' && !SENTINEL_QUESTION_IDS.has(p.qid))
    .map(p => {
      const question = questionsById.get(p.qid);
      const answer = resolveMultichoiceAnswer(question, p.answer);
      return {
        label: question?.description || `Q${p.qid}`,
        answer,
        isPhoto: question?.question_type === '11',
        isException: (!!p.defaultResponse && answer !== p.defaultResponse) || isOutOfRange(question, answer),
      };
    });
}

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
    const anyFail = group.some(r => r.inspection_result === 'N');
    const anyMissed = group.some(r => r.missed_point === 'Y');
    const anyPass = group.some(r => r.inspection_result === 'Y');
    const assetIds = [...new Set(group.map(r => r.asset_id).filter(Boolean))];
    const notesList = [...new Set(group.map(r => r.notes).filter(Boolean))];
    const gpsRow = group.find(r => Number.isFinite(r.gps_lat) && Number.isFinite(r.gps_lng));
    return {
      ...first,
      id: group.length > 1 ? `${first.id}-${group[group.length - 1].id}` : first.id,
      asset_id: assetIds.length > 0 ? assetIds.join(', ') : first.asset_id,
      inspection_result: anyFail ? 'N' : anyPass ? 'Y' : first.inspection_result,
      missed_point: !anyFail && anyMissed ? 'Y' : 'N',
      notes: notesList.length > 0 ? notesList.join(' ') : first.notes,
      gps_lat: gpsRow?.gps_lat,
      gps_lng: gpsRow?.gps_lng,
      _resultLabel: anyFail ? 'Fail' : anyMissed ? 'Missed' : anyPass ? 'Pass' : '—',
      _subRows: group,
    };
  });
}

function mergedAnsweredBlocks(r, questionsById) {
  const subRows = r._subRows || [r];
  return subRows
    .map(sub => ({ assetId: subRows.length > 1 ? sub.asset_id : null, pairs: answeredPairs(sub, questionsById) }))
    .filter(b => b.pairs.length > 0);
}

const PHOTO_RE = /\[PHOTO:([^\]]+)\]/g;

function PhotoThumb({ filename }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    client.get(`/pda/media/${encodeURIComponent(filename)}`, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filename]);

  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt={filename} className={styles.notesPhoto} />
    </a>
  );
}

const GPS_RE = /\[GPS:(-?[\d.]+),(-?[\d.]+)\]/g;

function GpsPinLink({ lat, lon }) {
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lon}`}
      target="_blank"
      rel="noreferrer"
      title={`View GPS location ${lat}, ${lon}`}
      className={styles.gpsPin}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C7.86 2 4.5 5.36 4.5 9.5c0 5.25 6.5 11.5 7.02 11.99a.7.7 0 0 0 .96 0C13 21 19.5 14.75 19.5 9.5 19.5 5.36 16.14 2 12 2zm0 10.25a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5z"/>
      </svg>
    </a>
  );
}

function NotesCell({ notes }) {
  if (!notes) return '—';
  const filenames = [...notes.matchAll(PHOTO_RE)].map(m => m[1]);
  const gpsPoints = [...notes.matchAll(GPS_RE)].map(m => ({ lat: m[1], lon: m[2] }));
  if (filenames.length === 0 && gpsPoints.length === 0) return notes;
  const rest = notes.replace(PHOTO_RE, '').replace(GPS_RE, '').trim();
  return (
    <div className={styles.notesWithPhoto}>
      {rest && <div>{rest}</div>}
      {gpsPoints.length > 0 && (
        <div className={styles.gpsPinRow}>
          {gpsPoints.map((g, i) => <GpsPinLink key={i} lat={g.lat} lon={g.lon} />)}
        </div>
      )}
      {filenames.map(f => <PhotoThumb key={f} filename={f} />)}
    </div>
  );
}

const TXN_DETAIL_COLUMNS = ['Result', 'Asset', 'Point ID', 'Point', 'Route', 'Date', 'Time', 'Inspector', 'Missed', 'Notes'];

function TransactionDetailTable({ txns, questionsById, routesById }) {
  const merged = useMemo(() => mergeContinuationRows(txns), [txns]);
  const sorted = useMemo(
    () => [...merged].sort((a, b) => (rowMs(b) ?? 0) - (rowMs(a) ?? 0)),
    [merged]
  );
  if (sorted.length === 0) {
    return <div className={styles.perfNoTxns}>No transactions in this date range.</div>;
  }
  return (
    <div className={styles.perfTxnTableWrap}>
      <table className={styles.perfTxnTable}>
        <thead>
          <tr>{TXN_DETAIL_COLUMNS.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const blocks = mergedAnsweredBlocks(r, questionsById);
            const resultLabel = r._resultLabel ?? (r.missed_point === 'Y' ? 'Missed' : r.inspection_result === 'Y' ? 'Pass' : r.inspection_result === 'N' ? 'Fail' : '—');
            return (
              <Fragment key={r.id}>
                <tr className={resultLabel === 'Fail' ? styles.perfTxnFail : undefined}>
                  <td>{resultLabel}</td>
                  <td>{r.asset_id || '—'}</td>
                  <td>{r.point_id || '—'}</td>
                  <td>{r.point_desc || '—'}</td>
                  <td>{routesById.get(r.route_id)?.name || r.route_id || '—'}</td>
                  <td>{r.trans_date ? r.trans_date.slice(0, 10) : '—'}</td>
                  <td>{r.trans_time ? r.trans_time.slice(11, 16) : '—'}</td>
                  <td>{r.guard || '—'}</td>
                  <td>{r.missed_point === 'Y' ? 'Y' : ''}</td>
                  <td><NotesCell notes={r.notes} /></td>
                </tr>
                {blocks.length > 0 && (
                  <tr className={styles.detailRow}>
                    <td colSpan={TXN_DETAIL_COLUMNS.length}>
                      <div className={styles.qaList}>
                        {blocks.map((block, bi) => (
                          <div key={bi} style={block.assetId ? { marginTop: bi > 0 ? 6 : 0 } : undefined}>
                            {block.assetId && <div className={styles.qaLabel}>Asset {block.assetId}:</div>}
                            {block.pairs.map((p, i) => (
                              <div key={i} className={p.isException ? styles.qaException : undefined}>
                                <span className={styles.qaLabel}>{p.label}:</span>{' '}
                                {p.isPhoto ? <PhotoThumb filename={p.answer.trim()} /> : p.answer}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const BUCKET_LABEL = { passed: 'Pass', failed: 'Fail', notScanned: 'Not Scanned', noResult: 'No Result' };
const BUCKET_COLOR = Object.fromEntries(SEGMENTS.map(s => [s.key, s.color]));

export default function LocationPerformanceReport() {
  const [points, setPoints] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [routePointsByRoute, setRoutePointsByRoute] = useState(new Map());
  const [questionsById, setQuestionsById] = useState(new Map());
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingList, setLoadingList] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [pointSearch, setPointSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pointAnchor, setPointAnchor] = useState(null); // last-clicked index in pickablePoints, for shift-range
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    Promise.all([getPoints(), getCustomers(), getSites(), getRoutes(), getAllRoutePoints(), getAllQuestions()])
      .then(([pts, c, s, r, byRoute, qs]) => {
        setPoints(pts); setCustomers(c); setSites(s); setRoutes(r);
        setRoutePointsByRoute(new Map(Object.entries(byRoute)));
        setQuestionsById(new Map(qs.map(q => [q.id, q])));
      })
      .finally(() => setLoading(false));
  }, []);

  const sitesById = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites]);
  const routesById = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes]);
  const sitesForCustomer = useMemo(
    () => customerId ? sites.filter(s => s.customer_id === customerId) : sites,
    [sites, customerId]
  );
  const routesForFilter = useMemo(() => routes.filter(r => {
    if (siteId) return r.site_id === siteId;
    if (customerId) return sitesById.get(r.site_id)?.customer_id === customerId;
    return true;
  }), [routes, sitesById, customerId, siteId]);

  // Points offered in the picker -- narrowed by Customer/Site/Route, then by
  // the search box. A tenant can have thousands of points, so without this
  // narrowing the list would be unusably long to scroll and check by hand --
  // selection itself is never limited to one site/route once picked, points
  // already checked stay checked even if you then narrow further.
  const pickablePoints = useMemo(() => {
    let list = points;
    if (routeId) {
      const onRoute = new Set((routePointsByRoute.get(routeId) || []).map(rp => rp.point_id));
      list = list.filter(p => onRoute.has(p.id));
    } else if (siteId) {
      list = list.filter(p => p.site_id === siteId);
    } else if (customerId) {
      list = list.filter(p => sitesById.get(p.site_id)?.customer_id === customerId);
    }
    const q = pointSearch.trim().toUpperCase();
    if (q) list = list.filter(p => p.point_code?.toUpperCase().includes(q) || p.description?.toUpperCase().includes(q));
    return [...list].sort((a, b) => a.point_code.localeCompare(b.point_code));
  }, [points, siteId, customerId, routeId, routePointsByRoute, sitesById, pointSearch]);

  const pointsById = useMemo(() => new Map(points.map(p => [p.id, p])), [points]);
  const selectedPoints = useMemo(
    () => [...selectedIds].map(id => pointsById.get(id)).filter(Boolean).sort((a, b) => a.point_code.localeCompare(b.point_code)),
    [selectedIds, pointsById]
  );

  function togglePoint(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  // Shift-click selects the contiguous range in pickablePoints between the
  // last-clicked item and this one, ADDING it to whatever's already checked
  // -- never replacing the whole selection, unlike a plain single-select
  // listbox's shift-click (RouteSetup.jsx's clickSelect), since this is an
  // accumulating checklist the admin builds up across several searches, and
  // wiping earlier picks on every shift-click would be destructive here.
  //
  // This is the ONLY place a click on a row is handled -- the checkbox
  // itself is display-only (readOnly, no onClick/onChange of its own). An
  // earlier version put preventDefault() on the checkbox's own onClick to
  // stop shift-click from also triggering its native toggle, but that raced
  // with the checkbox's onChange (which fired anyway right after), so the
  // very last point in a shift-clicked range got added by the range logic
  // and then immediately toggled back off by the checkbox's own change
  // event. Routing every click through one plain div with no native
  // checkbox behavior to suppress removes the race entirely.
  function handlePointClick(id, index, e) {
    if (e.shiftKey && pointAnchor != null) {
      const [lo, hi] = pointAnchor < index ? [pointAnchor, index] : [index, pointAnchor];
      const rangeIds = pickablePoints.slice(lo, hi + 1).map(p => p.id);
      setSelectedIds(prev => new Set([...prev, ...rangeIds]));
    } else {
      togglePoint(id);
      setPointAnchor(index);
    }
  }
  function selectAllVisible() {
    setSelectedIds(prev => new Set([...prev, ...pickablePoints.map(p => p.id)]));
  }
  function clearVisible() {
    const visibleIds = new Set(pickablePoints.map(p => p.id));
    setSelectedIds(prev => new Set([...prev].filter(id => !visibleIds.has(id))));
  }
  function clearAllSelected() {
    setSelectedIds(new Set());
  }

  function runQuery() {
    if (selectedIds.size === 0) { setTxns([]); return; }
    setLoadingList(true);
    getTransactions({
      from_date: fromDate || undefined,
      to_date: toDate ? `${toDate}T23:59:59` : undefined,
    }).then(txnRows => {
      setTxns(txnRows.filter(t => selectedIds.has(t.point_id)));
    }).finally(() => setLoadingList(false));
  }

  function clearFilters() {
    setCustomerId(''); setSiteId(''); setRouteId(''); setPointSearch(''); setSelectedIds(new Set());
    const d = new Date();
    d.setDate(d.getDate() - 30);
    setFromDate(d.toISOString().slice(0, 10));
    setToDate(new Date().toISOString().slice(0, 10));
    setTxns([]);
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();
  const perPoint = classifyPoints(selectedPoints.map(p => p.id), txns);
  const total = selectedPoints.length;

  return (
    <div className={styles.page}>
      <ReportHeader title="Location Performance" subtitle="Pick any set of points to track — regardless of which route(s) they're patrolled on" />
      <div className={styles.meta}>Generated {now} — {total} point(s) selected</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Customer</label>
          <select className={styles.filterSelect} value={customerId} onChange={e => { setCustomerId(e.target.value); setSiteId(''); setRouteId(''); }}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Site</label>
          <select className={styles.filterSelect} value={siteId} onChange={e => { setSiteId(e.target.value); setRouteId(''); }}>
            <option value="">All Sites</option>
            {sitesForCustomer.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Route</label>
          <select className={styles.filterSelect} value={routeId} onChange={e => setRouteId(e.target.value)}>
            <option value="">All Routes</option>
            {routesForFilter.map(r => <option key={r.id} value={r.id}>{r.name} — {r.route_code}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>From</label>
          <input type="date" className={styles.filterInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>To</label>
          <input type="date" className={styles.filterInput} value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <button className={styles.filterBtn} onClick={runQuery} disabled={loadingList || selectedIds.size === 0}>
          {loadingList ? '…' : 'Apply'}
        </button>
        <button className={styles.clearBtn} onClick={clearFilters}>Clear</button>
      </div>

      <div className={styles.pointPicker}>
        <div className={styles.pointPickerCol}>
          <div className={styles.pointPickerHeader}>
            <input
              className={styles.filterInput}
              style={{ width: '100%' }}
              placeholder="Search point code or description…"
              value={pointSearch}
              onChange={e => setPointSearch(e.target.value)}
            />
          </div>
          <div className={styles.pointPickerHint}>shift+click a range to select every point in between</div>
          <div className={styles.pointPickerList}>
            {pickablePoints.map((p, i) => (
              <div
                key={p.id}
                className={styles.pointPickerItem}
                onClick={e => handlePointClick(p.id, i, e)}
              >
                <input type="checkbox" checked={selectedIds.has(p.id)} readOnly tabIndex={-1} />
                <span className={styles.mono}>{p.point_code}</span>
                <span>{p.description}</span>
              </div>
            ))}
            {pickablePoints.length === 0 && <div className={styles.empty}>No points match this filter.</div>}
          </div>
          <div className={styles.pointPickerActions}>
            <button className={styles.expandToggleBtn} onClick={selectAllVisible}>Select All Shown ({pickablePoints.length})</button>
            <button className={styles.expandToggleBtn} onClick={clearVisible}>Clear Shown</button>
          </div>
        </div>

        <div className={styles.pointPickerCol}>
          <div className={styles.pointPickerHeader}>
            <strong>{selectedPoints.length} point(s) selected</strong>
            {selectedPoints.length > 0 && (
              <button className={styles.expandToggleBtn} onClick={clearAllSelected} style={{ marginLeft: 8 }}>Clear All</button>
            )}
          </div>
          <div className={styles.pointPickerList}>
            {selectedPoints.map(p => {
              const bucket = perPoint.get(p.id);
              return (
                <div key={p.id} className={styles.pointPickerItem}>
                  <span className={styles.mono}>{p.point_code}</span>
                  <span>{p.description}</span>
                  {bucket && (
                    <span style={{ marginLeft: 'auto', fontWeight: 600, color: BUCKET_COLOR[bucket] }}>
                      {BUCKET_LABEL[bucket]}
                    </span>
                  )}
                </div>
              );
            })}
            {selectedPoints.length === 0 && <div className={styles.empty}>Check points on the left to add them here.</div>}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className={styles.empty}>Select at least one point above, then click Apply.</div>
      ) : (
        // No pie/summary bucket here on purpose: that "one status per point"
        // rollup only really means something for a single route's own
        // checklist (PerformanceMetricsReport.jsx), where "latest visit
        // wins" reads as "current state of this route." An arbitrary,
        // hand-picked set of points over an open-ended date range doesn't
        // have that same single coherent "state" -- collapsing it to one
        // bucket per point hid real history (see the Sep 2026 investigation:
        // points with months of clean passes showed as 100% Not Scanned
        // over one isolated historical miss). The transaction list itself
        // is the unambiguous data for this report; showing it directly
        // avoids reintroducing that confusion.
        <div className={styles.perfCard}>
          <div className={styles.perfRouteTitle}>Transaction Detail — {total} point(s), {txns.length} transaction(s) in range</div>
          <TransactionDetailTable txns={txns} questionsById={questionsById} routesById={routesById} />
        </div>
      )}
      <ReportFooter />
    </div>
  );
}
