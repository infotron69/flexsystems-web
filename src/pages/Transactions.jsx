import { Fragment, useEffect, useState, useMemo } from 'react';
import client, { getLastDownload, getRoutes, getGuards, getAllQuestions, getCustomers, getSites, getPoints } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import usePrintLandscape from '../hooks/usePrintLandscape';
import styles from './Report.module.css';

const QA_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function rowMs(r) {
  const dateStr = r.trans_date ? r.trans_date.slice(0, 10) : null;
  const timeStr = r.trans_time ? r.trans_time.slice(11, 19) : null;
  return dateStr && timeStr ? new Date(`${dateStr}T${timeStr}`).getTime() : null;
}

// The legacy PDA app can write more than one Tbl_Transaction_Asset row for a
// single physical point visit — a "clone jump" continuation (a sentinel
// trigger row followed by a separate row holding the jump target's answers)
// or an embedded asset sub-scan (its own row, own Asset_ID, own Result,
// sandwiched between the point's own rows). Consecutive rows for the same
// route+point within MERGE_WINDOW_MS are the same visit and are combined
// into one display row. A fail anywhere in the group fails the whole visit.
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

  const merged = [];
  let prevGroupLastMs = null;
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const firstMs = rowMs(first);
    const elapsedMs = prevGroupLastMs != null && firstMs != null ? firstMs - prevGroupLastMs : null;
    const anyFail = group.some(r => r.inspection_result === 'N');
    const anyMissed = group.some(r => r.missed_point === 'Y');
    const anyPass = group.some(r => r.inspection_result === 'Y');
    const assetIds = [...new Set(group.map(r => r.asset_id).filter(Boolean))];
    const notesList = [...new Set(group.map(r => r.notes).filter(Boolean))];

    merged.push({
      ...first,
      id: group.length > 1 ? `${first.id}-${last.id}` : first.id,
      asset_id: assetIds.length > 0 ? assetIds.join(', ') : first.asset_id,
      inspection_result: anyFail ? 'N' : anyPass ? 'Y' : first.inspection_result,
      missed_point: !anyFail && anyMissed ? 'Y' : 'N',
      notes: notesList.length > 0 ? notesList.join(' ') : first.notes,
      _resultLabel: anyFail ? 'Fail' : anyMissed ? 'Missed' : anyPass ? 'Pass' : '—',
      _elapsed: elapsedMs != null ? formatElapsed(elapsedMs) : '0:00:00',
      _subRows: group,
    });
    prevGroupLastMs = rowMs(last) ?? prevGroupLastMs;
  }
  return merged;
}

function compareBy(sortKey, sortDir) {
  return (a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  };
}

// Mirrors TransactionReport.jsx's embedded Q&A + photo rendering so the
// last-download snapshot reads identically to the full Patrol Report.
// Question_ID 349 ("EXECUTING INSPECTION", Question_Type 9) is a PDA
// sequencing sentinel always answered "Start Question Sequence" — not a
// real answered question, never shown.
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

// A GPS-tagged scan is embedded as a "[GPS:lat,lon]" tag inside Notes. Rather
// than clutter the (now-narrower) Notes column with raw coordinate text, show
// a small pin that links straight to that location on a map.
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

// Notes with embedded photo and/or GPS tags (a merged multi-row visit can
// carry several of either) show the actual photo(s) and a linked pin icon per
// GPS tag, instead of the raw "[PHOTO:...]"/"[GPS:...]" reference text.
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

// Explicit `width` (as a colgroup, table-layout: fixed) keeps short columns
// like Date/Time from being squeezed onto two lines by the wide,
// variable-length Point/Notes text next to them.
const COLUMNS = [
  { key: 'id',            label: 'ID',        width: 7,  nowrap: true },
  { key: 'inspection_result', label: 'Result', width: 5,  nowrap: true },
  { key: 'asset_id',      label: 'Asset',     width: 6 },
  { key: 'point_id',      label: 'Point ID',  width: 6 },
  { key: 'point_desc',    label: 'Point',     width: 18 },
  { key: 'trans_date',    label: 'Date',      width: 6,  nowrap: true },
  { key: 'trans_time',    label: 'Time',      width: 4,  nowrap: true },
  { key: 'elapsed',       label: 'Elapsed',   width: 5,  nowrap: true },
  { key: 'call_no',       label: 'Call #',    width: 3,  nowrap: true },
  { key: 'guard',         label: 'Operator',  width: 8 },
  { key: 'missed_point',  label: 'Missed',    width: 3,  nowrap: true },
  { key: 'notes',         label: 'Notes',     width: 10 },
  { key: 'inc',           label: 'Incident',  width: 5 },
  { key: 'inc1',          label: 'Sub Cat 1', width: 5 },
  { key: 'inc2',          label: 'Sub Cat 2', width: 5 },
  { key: 'inc3',          label: 'Sub Cat 3', width: 5 },
];

// A merged row (>1 underlying transaction) needs its Q&A shown per
// sub-transaction so a labeled asset sub-scan's answers stay traceable to
// that asset rather than blending into the visit's other answers.
function mergedAnsweredBlocks(r, questionsById) {
  const subRows = r._subRows || [r];
  return subRows
    .map(sub => ({ assetId: subRows.length > 1 ? sub.asset_id : null, pairs: answeredPairs(sub, questionsById) }))
    .filter(b => b.pairs.length > 0);
}

function TransactionRows({ r, questionsById }) {
  const blocks = mergedAnsweredBlocks(r, questionsById);
  const resultLabel = r._resultLabel ?? (r.missed_point === 'Y' ? 'Missed' : r.inspection_result === 'Y' ? 'Pass' : r.inspection_result === 'N' ? 'Fail' : '—');
  return (
    <Fragment>
      <tr>
        <td className={styles.nowrapCell}>{r.id}</td>
        <td className={`${styles.nowrapCell} ${resultLabel === 'Fail' ? styles.qaException : ''}`}>{resultLabel}</td>
        <td>{r.asset_id || '—'}</td>
        <td>{r.point_id || '—'}</td>
        <td>{r.point_desc || '—'}</td>
        <td className={styles.nowrapCell}>{r.trans_date ? r.trans_date.slice(0, 10) : '—'}</td>
        <td className={styles.nowrapCell}>{r.trans_time ? r.trans_time.slice(11, 16) : '—'}</td>
        <td className={styles.nowrapCell}>{r._elapsed || '—'}</td>
        <td className={styles.nowrapCell}>{r.call_no ?? '—'}</td>
        <td>{r.guard || '—'}</td>
        <td className={styles.nowrapCell}>{r.missed_point === 'Y' ? 'Y' : ''}</td>
        <td><NotesCell notes={r.notes} /></td>
        <td>{r.inc || '—'}</td>
        <td>{r.inc1 || '—'}</td>
        <td>{r.inc2 || '—'}</td>
        <td>{r.inc3 || '—'}</td>
      </tr>
      {blocks.length > 0 && (
        <tr className={styles.detailRow}>
          <td colSpan={COLUMNS.length}>
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
}

export default function Transactions() {
  usePrintLandscape();
  const [rows, setRows] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [guards, setGuards] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [questionsById, setQuestionsById] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const [routeId, setRouteId] = useState('');
  const [guard, setGuard] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [missedFilter, setMissedFilter] = useState('');
  const [pointFilter, setPointFilter] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [pointsById, setPointsById] = useState(new Map());
  const [sortKey, setSortKey] = useState('trans_date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    Promise.all([getLastDownload(), getRoutes(), getGuards(), getAllQuestions(), getCustomers(), getSites(), getPoints()])
      .then(([txns, r, g, qs, custs, sts, pts]) => {
        setRows(txns);
        setRoutes(r);
        setGuards(g);
        setQuestionsById(new Map(qs.map(q => [q.id, q])));
        setCustomers(custs);
        setSites(sts);
        setPointsById(new Map(pts.map(p => [p.point_code, p])));
      })
      .finally(() => setLoading(false));
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

  function clearFilters() {
    setRouteId(''); setGuard(''); setResultFilter(''); setAssetFilter(''); setMissedFilter(''); setPointFilter('');
    setFilterCategory(''); setFilterSubCategory('');
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = useMemo(() => {
    const copy = rows.filter(r => {
      const point = pointsById.get(r.point_id);
      return (!routeId || r.route_id === routeId) &&
        (!guard || r.guard === guard) &&
        (!resultFilter || r.inspection_result === resultFilter) &&
        (!assetFilter || r.asset_id === assetFilter) &&
        (!missedFilter || r.missed_point === missedFilter) &&
        (!pointFilter || r.point_id === pointFilter) &&
        (!filterCategory || point?.category === filterCategory) &&
        (!filterSubCategory || point?.sub_category === filterSubCategory);
    });
    copy.sort(compareBy(sortKey, sortDir));
    return copy;
  }, [rows, sortKey, sortDir, routeId, guard, resultFilter, assetFilter, missedFilter, pointFilter, filterCategory, filterSubCategory, pointsById]);

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
    for (const cust of custMap.values()) {
      for (const site of cust.sites.values()) {
        for (const route of site.routes.values()) {
          route.rows = mergeContinuationRows(route.rows).sort(compareBy(sortKey, sortDir));
        }
      }
    }
    return [...custMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [sorted, customersById, sitesById, routesById, sortKey, sortDir]);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  return (
    <div className={styles.page}>
      <ReportHeader title="Last PDA Download" subtitle="Most recent PDA sync batch — filterable, click a column to sort" />
      <div className={styles.meta}>Generated {now} — {sorted.length} of {rows.length} transactions</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Route</label>
          <select className={styles.filterSelect} value={routeId} onChange={e => setRouteId(e.target.value)}>
            <option value="">All Routes</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name} — {r.route_code}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Operator</label>
          <select className={styles.filterSelect} value={guard} onChange={e => setGuard(e.target.value)}>
            <option value="">All Operators</option>
            {[...new Map(guards.map(g => [g.last_name, g])).values()]
              .sort((a, b) => a.last_name.localeCompare(b.last_name))
              .map(g => <option key={g.id} value={g.last_name}>{g.last_name}, {g.first_name}</option>)}
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
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Category</label>
          <select
            className={styles.filterSelect}
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); setFilterSubCategory(''); }}
          >
            <option value="">All Categories</option>
            {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Sub-Category</label>
          <select
            className={styles.filterSelect}
            value={filterSubCategory}
            onChange={e => setFilterSubCategory(e.target.value)}
            disabled={subCategoryOptions.length === 0}
          >
            <option value="">All</option>
            {subCategoryOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
          </select>
        </div>
        <button className={styles.clearBtn} onClick={clearFilters}>Clear</button>
      </div>

      <div className={styles.section}>
        <table className={`${styles.table} ${styles.patrolTable}`}>
          <colgroup>
            {COLUMNS.map(col => <col key={col.key} style={{ width: `${col.width}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map(col => (
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
                  <td colSpan={COLUMNS.length}>{cust.name}</td>
                </tr>
                {[...cust.sites.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([siteCode, site]) => (
                  <Fragment key={siteCode}>
                    <tr className={styles.groupHeaderSite}>
                      <td colSpan={COLUMNS.length}>{site.name}</td>
                    </tr>
                    {[...site.routes.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([routeCode, route]) => (
                      <Fragment key={routeCode}>
                        <tr className={styles.groupHeaderRoute}>
                          <td colSpan={COLUMNS.length}>{route.name}</td>
                        </tr>
                        {route.rows.map(r => <TransactionRows key={r.id} r={r} questionsById={questionsById} />)}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className={styles.empty}>No records in the last download match these filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <ReportFooter />
    </div>
  );
}
