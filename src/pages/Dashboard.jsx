import { Fragment, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import client, { getCustomers, getSites, getRoutes, getPoints, getGuards, getLastDownload, getAllQuestions, getRoutePoints } from '../api/client';
import GpsMapView from '../components/GpsMapView';
import GroupedTransactionTable from '../components/GroupedTransactionTable';
import ReportFooter from '../components/ReportFooter';
import { downloadPng } from '../utils/exportPng';
import reportStyles from './Report.module.css';
import styles from './Dashboard.module.css';

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Mirrors PerformanceMetricsReport.jsx's classification/pie-chart (kept as
// its own copy rather than a shared import, matching this codebase's
// established pattern of not refactoring working report pages into shared
// abstractions once they're proven, to avoid regression risk).
const PERF_SEGMENTS = [
  { key: 'passed',     label: 'Points Scanned and Passed',    color: '#16a34a' },
  { key: 'failed',     label: 'Points Scanned and Failed',    color: '#dc2626' },
  { key: 'notScanned', label: 'Points Not Scanned',           color: '#eab308' },
  { key: 'noResult',   label: 'Points Scanned and No Result', color: '#facc15' },
];

function perfPct(n, total) {
  return total > 0 ? (n / total) * 100 : 0;
}

function classifyRoutePoints(routePoints, txns) {
  const byPoint = new Map();
  for (const t of txns) {
    if (!byPoint.has(t.point_id)) byPoint.set(t.point_id, []);
    byPoint.get(t.point_id).push(t);
  }
  const counts = { passed: 0, failed: 0, notScanned: 0, noResult: 0 };
  for (const rp of routePoints) {
    const rows = byPoint.get(rp.point_id) || [];
    if (rows.length === 0) { counts.notScanned++; continue; }
    const latest = [...rows].sort((a, b) => `${a.trans_date}${a.trans_time}`.localeCompare(`${b.trans_date}${b.trans_time}`)).at(-1);
    if (latest.missed_point === 'Y') counts.notScanned++;
    else if (latest.inspection_result === 'Y') counts.passed++;
    else if (latest.inspection_result === 'N') counts.failed++;
    else counts.noResult++;
  }
  return counts;
}

function PerfPieChart({ counts, total, size = 140 }) {
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
  PERF_SEGMENTS.forEach(seg => {
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

function PerfRoutePanel({ route, total, counts, compact = false }) {
  const scanned = total - counts.notScanned;
  const scannedPassedPct = perfPct(counts.passed, total);
  const scannedPct = perfPct(scanned, total);
  return (
    <div className={reportStyles.perfCard}>
      {!compact && <div className={reportStyles.perfRouteTitle}>Route: {route.name} ({route.route_code})</div>}
      <div className={reportStyles.perfStatsRow}>
        <div className={reportStyles.perfStatCol}>
          <div className={reportStyles.perfStatLine}><span>Total Points for Route:</span><span>{total}</span></div>
          <div className={reportStyles.perfStatLine}><span>Points Scanned on Route:</span><span>{scanned}</span></div>
          <div className={reportStyles.perfStatLine}><span>Points Not Scanned on Route:</span><span>{counts.notScanned}</span></div>
          <div className={reportStyles.perfStatLine}><span>Percent Scanned on Route:</span><span>{scannedPct.toFixed(1)}%</span></div>
        </div>
        <div className={reportStyles.perfStatCol}>
          <div className={reportStyles.perfStatLine}><span>Points Scanned And Passed:</span><span>{counts.passed}</span></div>
          <div className={reportStyles.perfStatLine}><span>Points Scanned And Failed:</span><span>{counts.failed}</span></div>
          <div className={reportStyles.perfStatLine}><span>Percent Scanned And Passed:</span><span>{scannedPassedPct.toFixed(1)}%</span></div>
          <div className={reportStyles.perfStatLine}><span>Points Scanned And No Result:</span><span>{counts.noResult}</span></div>
        </div>
      </div>
      <div className={reportStyles.perfChartRow}>
        <PerfPieChart counts={counts} total={total} />
        <div className={reportStyles.perfLegend}>
          {PERF_SEGMENTS.map(seg => (
            <div key={seg.key} className={reportStyles.perfLegendItem}>
              <span className={reportStyles.perfLegendSwatch} style={{ background: seg.color }} />
              <span>{seg.label}: {counts[seg.key]} ({perfPct(counts[seg.key], total).toFixed(1)}%)</span>
            </div>
          ))}
          <div className={`${reportStyles.perfLegendItem} ${reportStyles.perfLegendTotal}`}>
            <span>Total: {total} (100.0%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_COLUMNS = [
  { key: 'inspection_result', label: 'Result' },
  { key: 'asset_id',          label: 'Asset' },
  { key: 'point_id',          label: 'Point ID' },
  { key: 'point_desc',        label: 'Point' },
  { key: 'trans_date',        label: 'Date' },
  { key: 'trans_time',        label: 'Time' },
  { key: 'guard',             label: 'Operator' },
  { key: 'missed_point',      label: 'Missed' },
  { key: 'notes',             label: 'Notes' },
];

const QA_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Question_ID 349 ("EXECUTING INSPECTION") is a PDA sequencing sentinel, not
// a real answered question — mirrors TransactionReport.jsx.
const SENTINEL_QUESTION_IDS = new Set([349]);

// A MULTICHOICE (type 2) answer is stored as the 1-based choice index the
// PDA recorded, not the option text -- resolve it via the question's
// option1-5 so the report shows the actual choice (e.g. "PASS") instead of
// a bare digit, and so the exception comparison below (against
// default_response, which IS stored as text) is meaningful.
function resolveMultichoiceAnswer(question, answer) {
  if (!question || question.question_type !== '2') return answer;
  const idx = parseInt(answer, 10);
  if (Number.isNaN(idx)) return answer;
  const options = [question.option1, question.option2, question.option3, question.option4, question.option5];
  return options[idx - 1] || answer;
}

// A LOW/NORMAL/HIGH (type 4) question has no default_response to compare
// against -- it's validated against low_alarm/high_alarm instead, so a
// numeric answer outside that band is the exception here.
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

function rowMs(r) {
  if (!r.trans_date || !r.trans_time) return null;
  const dateStr = r.trans_date.slice(0, 10);
  const timeStr = r.trans_time.slice(11, 19);
  return new Date(`${dateStr}T${timeStr}`).getTime();
}

// Mirrors TransactionReport.jsx's mergeContinuationRows: the legacy PDA app
// can write more than one Tbl_Transaction_Asset row for a single physical
// point visit (a clone-jump continuation, or an embedded asset sub-scan with
// its own Result). Consecutive same-route+point rows within this window are
// the same visit, combined into one row -- a fail anywhere in the group
// fails the whole visit, so a failing sub-answer is never hidden behind an
// otherwise-passing point.
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
    const anyFail = group.some(r => r.inspection_result === 'N');
    const anyMissed = group.some(r => r.missed_point === 'Y');
    const anyPass = group.some(r => r.inspection_result === 'Y');
    const assetIds = [...new Set(group.map(r => r.asset_id).filter(Boolean))];
    const notesList = [...new Set(group.map(r => r.notes).filter(Boolean))];
    // A GPS fix may land on any sub-row of the visit, not necessarily the
    // first -- don't silently drop the pin because the merge picked a
    // different sub-row as its base.
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

// One Q&A block per underlying sub-transaction, so a labeled asset sub-scan's
// answers stay traceable to that asset rather than blending into the visit's
// other answers -- mirrors mergedAnsweredBlocks in the other reports.
function mergedAnsweredBlocks(r, questionsById) {
  const subRows = r._subRows || [r];
  return subRows
    .map(sub => ({ assetId: subRows.length > 1 ? sub.asset_id : null, pairs: answeredPairs(sub, questionsById) }))
    .filter(b => b.pairs.length > 0);
}

// A PDA-captured photo is embedded as a "[PHOTO:filename.jpg]" tag inside
// Notes (mirrors TransactionReport.jsx's PhotoThumb/NotesCell). Fetched via
// an authenticated request since <img src> can't carry the auth header.
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
      <img src={src} alt={filename} className={reportStyles.notesPhoto} />
    </a>
  );
}

// A GPS-tagged scan is embedded as a "[GPS:lat,lon]" tag inside Notes
// (mirrors TransactionReport.jsx's GPS_RE/GpsPinLink).
const GPS_RE = /\[GPS:(-?[\d.]+),(-?[\d.]+)\]/g;

function GpsPinLink({ lat, lon }) {
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lon}`}
      target="_blank"
      rel="noreferrer"
      title={`View GPS location ${lat}, ${lon}`}
      className={reportStyles.gpsPin}
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
    <div className={reportStyles.notesWithPhoto}>
      {rest && <div>{rest}</div>}
      {gpsPoints.length > 0 && (
        <div className={reportStyles.gpsPinRow}>
          {gpsPoints.map((g, i) => <GpsPinLink key={i} lat={g.lat} lon={g.lon} />)}
        </div>
      )}
      {filenames.map(f => <PhotoThumb key={f} filename={f} />)}
    </div>
  );
}

function ActivityRow({ r, questionsById }) {
  const blocks = mergedAnsweredBlocks(r, questionsById);
  const resultLabel = r._resultLabel ?? (r.missed_point === 'Y' ? 'Missed' : r.inspection_result === 'Y' ? 'Pass' : r.inspection_result === 'N' ? 'Fail' : '—');
  return (
    <Fragment>
      <tr>
        <td className={resultLabel === 'Fail' ? reportStyles.qaException : undefined}>{resultLabel}</td>
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
        <tr className={reportStyles.detailRow}>
          <td colSpan={ACTIVITY_COLUMNS.length}>
            <div className={reportStyles.qaList}>
              {blocks.map((block, bi) => (
                <div key={bi} style={block.assetId ? { marginTop: bi > 0 ? 6 : 0 } : undefined}>
                  {block.assetId && <div className={reportStyles.qaLabel}>Asset {block.assetId}:</div>}
                  {block.pairs.map((p, i) => (
                    <div key={i} className={p.isException ? reportStyles.qaException : undefined}>
                      <span className={reportStyles.qaLabel}>{p.label}:</span>{' '}
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
}

function StatCard({ label, value, color }) {
  return (
    <div className={styles.card} style={{ borderTopColor: color }}>
      <div className={styles.value}>{value ?? '…'}</div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats]         = useState({});
  const [recent, setRecent]       = useState([]);
  const [routes, setRoutes]       = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites]         = useState([]);
  const [questionsById, setQuestionsById] = useState(new Map());
  const [loading, setLoading]     = useState(true);
  const navigate = useNavigate();

  const [routeId, setRouteId] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [missedFilter, setMissedFilter] = useState('');
  const [pointFilter, setPointFilter] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [pointsById, setPointsById] = useState(new Map());
  const [exportingPng, setExportingPng] = useState(false);
  const activityRef = useRef(null);

  useEffect(() => {
    Promise.all([
      getCustomers(),
      getSites(),
      getRoutes(),
      getPoints(),
      getGuards(),
      getLastDownload(),
      getAllQuestions(),
    ]).then(([custs, sts, rts, points, guards, txns, questions]) => {
      setStats({
        customers: custs.length,
        sites:     sts.length,
        routes:    rts.length,
        points:    points.length,
        operators: guards.length,
      });
      setCustomers(custs);
      setSites(sts);
      setRoutes(rts);
      setRecent(txns);
      setQuestionsById(new Map(questions.map(q => [q.id, q])));
      setPointsById(new Map(points.map(p => [p.point_code, p])));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const routesById = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes]);
  const customersById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const sitesById = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites]);

  // Performance Metrics only shows routes with activity in the current date
  // range (matching the daily PDF's scope), not every route the customer has.
  const activeRoutes = useMemo(() => {
    const ids = new Set(recent.map(r => r.route_id).filter(Boolean));
    return [...ids].map(id => routesById.get(id)).filter(Boolean);
  }, [recent, routesById]);

  const [routePointsByRoute, setRoutePointsByRoute] = useState(new Map());
  const [loadingPerf, setLoadingPerf] = useState(true);

  useEffect(() => {
    if (activeRoutes.length === 0) { setRoutePointsByRoute(new Map()); setLoadingPerf(false); return; }
    setLoadingPerf(true);
    Promise.all(activeRoutes.map(r => getRoutePoints(r.id).then(pts => [r.id, pts])))
      .then(pairs => setRoutePointsByRoute(new Map(pairs)))
      .catch(() => {})
      .finally(() => setLoadingPerf(false));
  }, [activeRoutes]);

  const assetOptions = useMemo(() => [...new Set(recent.map(r => r.asset_id).filter(Boolean))].sort(), [recent]);
  const pointOptions = useMemo(() => {
    const map = new Map();
    recent.forEach(r => { if (r.point_id && !map.has(r.point_id)) map.set(r.point_id, r.point_desc || r.point_id); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [recent]);
  const categoryOptions = useMemo(
    () => [...new Set([...pointsById.values()].map(p => p.category).filter(Boolean))].sort(),
    [pointsById]
  );
  const subCategoryOptions = useMemo(
    () => [...new Set(
      [...pointsById.values()]
        .filter(p => !filterCategory || p.category === filterCategory)
        .map(p => p.sub_category)
        .filter(Boolean)
    )].sort(),
    [pointsById, filterCategory]
  );

  const filteredActivity = useMemo(() => recent.filter(r => {
    const point = pointsById.get(r.point_id);
    return (!routeId || r.route_id === routeId) &&
      (!resultFilter || r.inspection_result === resultFilter) &&
      (!assetFilter || r.asset_id === assetFilter) &&
      (!missedFilter || r.missed_point === missedFilter) &&
      (!pointFilter || r.point_id === pointFilter) &&
      (!filterCategory || point?.category === filterCategory) &&
      (!filterSubCategory || point?.sub_category === filterSubCategory);
  }), [recent, routeId, resultFilter, assetFilter, missedFilter, pointFilter, filterCategory, filterSubCategory, pointsById]);

  const mergedActivity = useMemo(() => mergeContinuationRows(filteredActivity), [filteredActivity]);

  function clearFilters() {
    setRouteId(''); setResultFilter(''); setAssetFilter(''); setMissedFilter(''); setPointFilter('');
    setFilterCategory(''); setFilterSubCategory('');
  }

  // The transaction list scrolls internally (activityScroll's max-height),
  // so a snapshot taken as-is would just show whatever's currently visible
  // -- expand it to full height for the capture, then restore, mirroring
  // the @media print override already used for the Print button.
  async function exportActivityPng() {
    const scrollEl = activityRef.current?.querySelector(`.${styles.activityScroll}`);
    const prevMaxHeight = scrollEl?.style.maxHeight;
    const prevOverflow = scrollEl?.style.overflow;
    if (scrollEl) {
      scrollEl.style.maxHeight = 'none';
      scrollEl.style.overflow = 'visible';
    }
    setExportingPng(true);
    try {
      await downloadPng(activityRef.current, `flexpatrol-dashboard-activity-${timestampForFilename()}`);
    } finally {
      if (scrollEl) {
        scrollEl.style.maxHeight = prevMaxHeight || '';
        scrollEl.style.overflow = prevOverflow || '';
      }
      setExportingPng(false);
    }
  }

  const tenantLabel = localStorage.getItem('tenantLabel');

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h2 className={styles.heading}>
          Dashboard
          {tenantLabel && <span className={styles.tenantLabel}> — {tenantLabel}</span>}
        </h2>
        <button className={reportStyles.printBtn} onClick={() => window.print()}>Print</button>
      </div>

      <div className={styles.grid}>
        <StatCard label="Customers" value={stats.customers} color="#1a2332" />
        <StatCard label="Sites"     value={stats.sites}     color="#3b6fe0" />
        <StatCard label="Routes"    value={stats.routes}    color="#16a34a" />
        <StatCard label="Points"    value={stats.points}    color="#ea580c" />
        <StatCard label="Operators" value={stats.operators} color="#7c3aed" />
      </div>

      <div className={styles.activitySection} ref={activityRef}>
        <div className={styles.activityHeader}>
          <h3 className={styles.activityTitle}>Recent Activity {!loading && `(${filteredActivity.length} of ${recent.length})`}</h3>
          <div data-html2canvas-ignore="true" style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
            <button className={styles.viewAllBtn} onClick={exportActivityPng} disabled={exportingPng}>
              {exportingPng ? 'Exporting…' : 'Export PNG'}
            </button>
            <button className={styles.viewAllBtn} onClick={() => navigate('/transactions')}>
              View All Transactions &rarr;
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : (
          <>
            <div className={reportStyles.filterBar} style={{ marginBottom: 12 }} data-html2canvas-ignore="true">
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Route</label>
                <select className={reportStyles.filterSelect} value={routeId} onChange={e => setRouteId(e.target.value)}>
                  <option value="">All Routes</option>
                  {routes.map(r => <option key={r.id} value={r.id}>{r.name} — {r.route_code}</option>)}
                </select>
              </div>
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Result</label>
                <select className={reportStyles.filterSelect} value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
                  <option value="">All Results</option>
                  <option value="Y">Pass</option>
                  <option value="N">Fail</option>
                </select>
              </div>
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Asset</label>
                <select className={reportStyles.filterSelect} value={assetFilter} onChange={e => setAssetFilter(e.target.value)}>
                  <option value="">All Assets</option>
                  {assetOptions.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Missed</label>
                <select className={reportStyles.filterSelect} value={missedFilter} onChange={e => setMissedFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="Y">Missed Only</option>
                  <option value="N">Not Missed</option>
                </select>
              </div>
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Point</label>
                <select className={reportStyles.filterSelect} value={pointFilter} onChange={e => setPointFilter(e.target.value)}>
                  <option value="">All Points</option>
                  {pointOptions.map(([id, desc]) => <option key={id} value={id}>{desc}</option>)}
                </select>
              </div>
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Category</label>
                <select
                  className={reportStyles.filterSelect}
                  value={filterCategory}
                  onChange={e => { setFilterCategory(e.target.value); setFilterSubCategory(''); }}
                >
                  <option value="">All Categories</option>
                  {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className={reportStyles.filterField}>
                <label className={reportStyles.filterLabel}>Sub-Category</label>
                <select
                  className={reportStyles.filterSelect}
                  value={filterSubCategory}
                  onChange={e => setFilterSubCategory(e.target.value)}
                  disabled={subCategoryOptions.length === 0}
                >
                  <option value="">All</option>
                  {subCategoryOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
              </div>
              <button className={reportStyles.clearBtn} onClick={clearFilters}>Clear</button>
            </div>

            <div className={styles.activityScroll}>
              <GroupedTransactionTable
                rows={mergedActivity}
                columns={ACTIVITY_COLUMNS}
                renderRow={r => <ActivityRow key={r.id} r={r} questionsById={questionsById} />}
                customersById={customersById}
                sitesById={sitesById}
                routesById={routesById}
                emptyMessage="No activity matches these filters"
                onRouteClick={routeCode => navigate(`/reports/transactions?route=${routeCode}`)}
                renderRouteExtra={routeCode => {
                  const route = routesById.get(routeCode);
                  if (!route) return null;
                  const routePoints = routePointsByRoute.get(routeCode) || [];
                  // Map only the rows actually shown in this route's table
                  // below -- not every GPS-tagged scan ever recorded for it -
                  // and with the merged (fail-wins) Result, so a marker's
                  // popup never disagrees with the row it corresponds to.
                  const routeGpsRows = mergedActivity.filter(r =>
                    r.route_id === routeCode && Number.isFinite(r.gps_lat) && Number.isFinite(r.gps_lng)
                  );
                  const perfPanel = !loadingPerf && routePoints.length > 0 && (() => {
                    const routeTxns = recent.filter(r => r.route_id === routeCode);
                    const counts = classifyRoutePoints(routePoints, routeTxns);
                    return <PerfRoutePanel route={route} total={routePoints.length} counts={counts} compact />;
                  })();
                  if (!perfPanel && routeGpsRows.length === 0) return null;
                  return (
                    <Fragment>
                      {perfPanel}
                      {routeGpsRows.length > 0 && (
                        <div className={styles.routeGpsMap}>
                          <div className={styles.routeGpsMapTitle}>GPS Map ({routeGpsRows.length})</div>
                          <GpsMapView rows={routeGpsRows} height={220} />
                        </div>
                      )}
                    </Fragment>
                  );
                }}
              />
            </div>
          </>
        )}
      </div>
      <ReportFooter />
    </div>
  );
}
