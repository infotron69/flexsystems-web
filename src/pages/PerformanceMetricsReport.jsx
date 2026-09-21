import { Fragment, useEffect, useState, useMemo } from 'react';
import client, { getTransactions, getRoutes, getCustomers, getSites, getAllRoutePoints, getAllQuestions } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import styles from './Report.module.css';

// Legacy "Performance Metrics" report: per point on a route, over a date
// range, classify into exactly one bucket so the buckets always sum to
// Total Points for Route. A point with zero transactions in range never
// got visited at all ("Not Scanned"); otherwise the point's latest-in-range
// Inspection_Result decides Pass/Fail/No Result. (Points Missed is
// deliberately not tracked as its own bucket here.)
const SEGMENTS = [
  { key: 'passed',     label: 'Points Scanned and Passed',    color: '#16a34a' },
  { key: 'failed',     label: 'Points Scanned and Failed',    color: '#dc2626' },
  { key: 'notScanned', label: 'Points Not Scanned',           color: '#eab308' },
  { key: 'noResult',   label: 'Points Scanned and No Result', color: '#facc15' },
];

function pct(n, total) {
  return total > 0 ? (n / total) * 100 : 0;
}

function rowMs(r) {
  const dateStr = r.trans_date ? r.trans_date.slice(0, 10) : null;
  const timeStr = r.trans_time ? r.trans_time.slice(11, 19) : null;
  return dateStr && timeStr ? new Date(`${dateStr}T${timeStr}`).getTime() : null;
}

// The legacy PDA app can write more than one Tbl_Transaction_Asset row for a
// single physical point visit (a clone-jump continuation, or an embedded
// asset sub-scan) -- consecutive rows for the same route+point within this
// window are the same visit, mirroring TransactionReport.jsx's
// mergeContinuationRows. A raw sub-row must never be classified on its own:
// a failed asset sub-scan followed by its own separate Pass/no-result rows
// would otherwise let whichever sub-row happens to be latest override the
// Fail-Wins result shown for that same visit everywhere else.
const MERGE_WINDOW_MS = 60 * 1000;

function classifyRoutePoints(routePoints, txns) {
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

  const counts = { passed: 0, failed: 0, notScanned: 0, noResult: 0 };
  for (const rp of routePoints) {
    const visits = visitsByPoint.get(rp.point_id) || [];
    if (visits.length === 0) { counts.notScanned++; continue; }
    const latest = [...visits].sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0)).at(-1);
    // A missed point isn't a genuine inspection, regardless of whatever
    // Inspection_Result the placeholder row carries.
    if (latest.missed_point === 'Y') counts.notScanned++;
    else if (latest.inspection_result === 'Y') counts.passed++;
    else if (latest.inspection_result === 'N') counts.failed++;
    else counts.noResult++;
  }
  return counts;
}

function PieChart({ counts, total, size = 160 }) {
  const r = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#eef1f7" stroke="#d5d9e0" />
      </svg>
    );
  }
  let angle = -90;
  const slices = [];
  SEGMENTS.forEach(seg => {
    const value = counts[seg.key];
    if (value <= 0) return;
    const fraction = value / total;
    const startAngle = angle;
    const endAngle = angle + fraction * 360;
    angle = endAngle;
    if (fraction >= 0.9999) {
      slices.push(<circle key={seg.key} cx={cx} cy={cy} r={r} fill={seg.color} />);
      return;
    }
    const toXY = a => {
      const rad = (a * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    const [x1, y1] = toXY(startAngle);
    const [x2, y2] = toXY(endAngle);
    const large = fraction > 0.5 ? 1 : 0;
    slices.push(
      <path key={seg.key} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={seg.color} stroke="#fff" strokeWidth="1" />
    );
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices}
    </svg>
  );
}

// Everything below (through TransactionDetailTable) mirrors Dashboard.jsx's
// Recent Activity implementation -- same continuation-merge, exception, and
// photo/GPS rendering rules, kept as its own copy rather than a shared
// import per this codebase's established pattern for report pages.
const QA_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Question_ID 349 ("EXECUTING INSPECTION") is a PDA sequencing sentinel, not
// a real answered question.
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

const TXN_DETAIL_COLUMNS = ['Result', 'Asset', 'Point ID', 'Point', 'Date', 'Time', 'Inspector', 'Missed', 'Notes'];

function TransactionDetailTable({ txns, questionsById }) {
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

function RoutePanel({ route, total, counts, txns, questionsById }) {
  const [showTxns, setShowTxns] = useState(false);
  const scanned = total - counts.notScanned;
  const scannedPassedPct = pct(counts.passed, total);
  const scannedPct = pct(scanned, total);
  return (
    <div className={styles.perfCard}>
      <div className={styles.perfRouteTitle}>Route: {route.name} ({route.route_code})</div>
      <div className={styles.perfStatsRow}>
        <div className={styles.perfStatCol}>
          <div className={styles.perfStatLine}><span>Total Points for Route:</span><span>{total}</span></div>
          <div className={styles.perfStatLine}><span>Points Scanned on Route:</span><span>{scanned}</span></div>
          <div className={styles.perfStatLine}><span>Points Not Scanned on Route:</span><span>{counts.notScanned}</span></div>
          <div className={styles.perfStatLine}><span>Percent Scanned on Route:</span><span>{scannedPct.toFixed(1)}%</span></div>
        </div>
        <div className={styles.perfStatCol}>
          <div className={styles.perfStatLine}><span>Points Scanned And Passed:</span><span>{counts.passed}</span></div>
          <div className={styles.perfStatLine}><span>Points Scanned And Failed:</span><span>{counts.failed}</span></div>
          <div className={styles.perfStatLine}><span>Percent Scanned And Passed:</span><span>{scannedPassedPct.toFixed(1)}%</span></div>
          <div className={styles.perfStatLine}><span>Points Scanned And No Result:</span><span>{counts.noResult}</span></div>
        </div>
      </div>
      <div className={styles.perfChartRow}>
        <PieChart counts={counts} total={total} />
        <div className={styles.perfLegend}>
          {SEGMENTS.map(seg => (
            <div key={seg.key} className={styles.perfLegendItem}>
              <span className={styles.perfLegendSwatch} style={{ background: seg.color }} />
              <span>{seg.label}: {counts[seg.key]} ({pct(counts[seg.key], total).toFixed(1)}%)</span>
            </div>
          ))}
          <div className={`${styles.perfLegendItem} ${styles.perfLegendTotal}`}>
            <span>Total: {total} (100.0%)</span>
          </div>
        </div>
      </div>
      <div className={styles.perfTxnHeadingRow}>
        <button
          type="button"
          className={styles.perfDetailToggle}
          onClick={() => setShowTxns(s => !s)}
          aria-expanded={showTxns}
        >
          {showTxns ? 'Hide Transaction Detail ▾' : `Show Transaction Detail (${txns.length}) ▸`}
        </button>
      </div>
      {showTxns && <TransactionDetailTable txns={txns} questionsById={questionsById} />}
    </div>
  );
}

export default function PerformanceMetricsReport() {
  const [routes, setRoutes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [routePointsByRoute, setRoutePointsByRoute] = useState(new Map());
  const [questionsById, setQuestionsById] = useState(new Map());
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingList, setLoadingList] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    // Points-by-route is fetched once here, in bulk, rather than per-route
    // inside runQuery() below -- it doesn't depend on the date range, and a
    // tenant can have 140+ routes, so it must not be refetched per-route on
    // every filter change.
    Promise.all([getRoutes(), getCustomers(), getSites(), getAllRoutePoints(), getAllQuestions()])
      .then(([r, c, s, byRoute, qs]) => {
        setRoutes(r); setCustomers(c); setSites(s);
        setRoutePointsByRoute(new Map(Object.entries(byRoute)));
        setQuestionsById(new Map(qs.map(q => [q.id, q])));
      })
      .finally(() => setLoading(false));
  }, []);

  const sitesById = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites]);
  const customersById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const visibleRoutes = useMemo(() => routes.filter(r => {
    const site = sitesById.get(r.site_id);
    if (siteId && r.site_id !== siteId) return false;
    if (customerId && site?.customer_id !== customerId) return false;
    if (routeId && r.id !== routeId) return false;
    return true;
  }), [routes, sitesById, customerId, siteId, routeId]);

  const sitesForCustomer = useMemo(
    () => customerId ? sites.filter(s => s.customer_id === customerId) : sites,
    [sites, customerId]
  );
  const routesForFilter = useMemo(
    () => routes.filter(r => {
      const site = sitesById.get(r.site_id);
      if (siteId) return r.site_id === siteId;
      if (customerId) return site?.customer_id === customerId;
      return true;
    }),
    [routes, sitesById, customerId, siteId]
  );

  function runQuery() {
    setLoadingList(true);
    getTransactions({
      from_date: fromDate || undefined,
      to_date: toDate ? `${toDate}T23:59:59` : undefined,
    }).then(txnRows => {
      setTxns(txnRows);
    }).finally(() => setLoadingList(false));
  }

  useEffect(() => { if (!loading) runQuery(); }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearFilters() {
    setCustomerId(''); setSiteId(''); setRouteId('');
    const d = new Date();
    d.setDate(d.getDate() - 30);
    setFromDate(d.toISOString().slice(0, 10));
    setToDate('');
  }

  // Every customer/site matching the Customer/Site filters gets a row here
  // even when it has zero routes matching the Route/date filters -- a site
  // with nothing to show still needs to be visible (with an empty-state
  // message) rather than silently disappearing from the report, which reads
  // as "this site doesn't exist" rather than "this site has no matches".
  const grouped = useMemo(() => {
    const custMap = new Map();

    const matchingSites = sites.filter(s => {
      if (siteId) return s.id === siteId;
      if (customerId) return s.customer_id === customerId;
      return true;
    });
    for (const site of matchingSites) {
      const custCode = site.customer_id || '—';
      if (!custMap.has(custCode)) {
        custMap.set(custCode, { name: customersById.get(custCode)?.name || custCode, sites: new Map() });
      }
      custMap.get(custCode).sites.set(site.id, { name: site.name || site.id, routes: [] });
    }

    for (const route of visibleRoutes) {
      const site = sitesById.get(route.site_id);
      const custCode = site?.customer_id || '—';
      const siteCode = route.site_id || '—';
      if (!custMap.has(custCode)) {
        custMap.set(custCode, { name: customersById.get(custCode)?.name || custCode, sites: new Map() });
      }
      const cust = custMap.get(custCode);
      if (!cust.sites.has(siteCode)) {
        cust.sites.set(siteCode, { name: site?.name || siteCode, routes: [] });
      }
      cust.sites.get(siteCode).routes.push(route);
    }
    return [...custMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [visibleRoutes, sites, sitesById, customersById, customerId, siteId]);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  return (
    <div className={styles.page}>
      <ReportHeader title="Performance Metrics" subtitle={`Transactions scanned from ${fromDate || '…'} to ${toDate || 'today'}`} />
      <div className={styles.meta}>Generated {now} — {visibleRoutes.length} route(s)</div>

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
        <button className={styles.filterBtn} onClick={runQuery} disabled={loadingList}>
          {loadingList ? '…' : 'Apply'}
        </button>
        <button className={styles.clearBtn} onClick={clearFilters}>Clear</button>
      </div>

      {loadingList ? <div className={styles.loading}>Loading…</div> : (
        grouped.length === 0 ? <div className={styles.empty}>No customers or sites match these filters</div> : (
          grouped.map(([custCode, cust]) => (
            <div key={custCode}>
              <div className={styles.perfCustomerHeader}>{cust.name}</div>
              {[...cust.sites.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([siteCode, site]) => {
                return (
                  <div key={siteCode}>
                    <div className={styles.perfSiteHeader}>Site: {site.name}</div>
                    {site.routes.length === 0 && (
                      <div className={styles.perfSiteEmpty}>No routes match the current Route/date filters.</div>
                    )}
                    {site.routes.map(route => {
                      const routePoints = routePointsByRoute.get(route.id) || [];
                      const routeTxns = txns.filter(t => t.route_id === route.id);
                      const counts = classifyRoutePoints(routePoints, routeTxns);
                      return (
                        <RoutePanel
                          key={route.id}
                          route={route}
                          total={routePoints.length}
                          counts={counts}
                          txns={routeTxns}
                          questionsById={questionsById}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))
        )
      )}
      <ReportFooter />
    </div>
  );
}
