import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSites, getRoutes, getAllRoutePoints, getRoutePointQuestionsAll, getPoints, getPointAllQuestions } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import FindSortBar from '../components/FindSortBar';
import { downloadCsv } from '../utils/exportCsv';
import { useFindSort, matchesFind, findAndSort } from '../utils/reportView';
import styles from './Report.module.css';

const SORT_OPTIONS = [
  { key: 'point_code', label: 'Point Code' },
  { key: 'description', label: 'Point Description' },
  { key: 'questions', label: 'Number of Questions' },
];

const TYPE_LABEL = {
  '1': 'YES/NO', '2': 'MULTICHOICE', '3': 'ALPHA/NUM', '4': 'LOW/NORMAL/HIGH',
  '5': 'MULTISELECT', '6': 'SHOWFILE', '7': 'ASSET SCAN', '8': 'PICKLIST',
  '9': 'CLONE JUMP', '10': 'SIGNATURE', '11': 'PHOTO', '12': 'CHECKLIST',
};

// Mirrors the mobile app's own classifyJump() (DataEngine.js) exactly --
// a jump value is never just an opaque code, it's one of a handful of
// distinct things: a sequence number to jump to within THIS SAME point's
// own checklist, a special sentinel (log an incident, exit the route,
// resume the last scanned point), or a real 10-char point code -- most
// often an SOP point under the Incidents1 site (Clone/Virtual/Half-clone
// jumps all start with C/V/H respectively). Resolving that to readable
// text (rather than a bare code no one could read without cross-
// referencing separately) is the whole point of this helper.
function classifyJump(value) {
  const v = (value || '').trim();
  if (!v || v === '0') return { type: 'done' };
  if (v === '98') return { type: 'incidents' };
  if (v === '99') return { type: 'exit_route' };
  if (v === '96' || v === '97') return { type: 'jump_last_scanned' };
  if (v.startsWith('C')) return { type: 'point', code: v };
  if (v.startsWith('V')) return { type: 'point', code: v };
  if (v.startsWith('H')) return { type: 'point', code: v };
  if (v.length === 10) return { type: 'point', code: v };
  return { type: 'next_seq', seqNo: v };
}

function jumpText(value, seqnoToDesc, pointsByCode) {
  const c = classifyJump(value);
  switch (c.type) {
    case 'done':               return '—';
    case 'incidents':          return '→ Log Incident';
    case 'exit_route':         return '→ Exit Route';
    case 'jump_last_scanned':  return '→ Resume Last Point';
    case 'next_seq': {
      const desc = seqnoToDesc.get(c.seqNo);
      return desc ? `→ Seq ${c.seqNo}: ${desc}` : `→ Seq ${c.seqNo}`;
    }
    case 'point': {
      const p = pointsByCode.get(c.code);
      return `→ ${c.code.trim()}${p ? ` — ${p.description}` : ''}`;
    }
    default: return value || '—';
  }
}

export default function RouteQuestionsReport() {
  const navigate = useNavigate();
  const view = useFindSort('point_code');
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [routes, setRoutes] = useState([]);
  const [data, setData] = useState({}); // routeId -> [{point, questions}]
  const [sopOnly, setSopOnly] = useState(false);
  const [routeFilter, setRouteFilter] = useState('');
  // All points system-wide (not just this site's) -- a jump target is
  // routinely a point on another site entirely, most often an SOP point
  // under Incidents1, so resolving it to readable text needs the full set.
  const [pointsByCode, setPointsByCode] = useState(new Map());
  // "Show nested SOP questions" -- when on, any jump that lands on another
  // point (Clone/Virtual/Half-clone, or a plain point-code jump) expands
  // that point's own checklist inline instead of just naming it. Opt-in:
  // eagerly expanding every clone jump across a whole site by default would
  // mean a lot of extra fetching for a report most views don't need it on.
  const [expandNested, setExpandNested] = useState(false);
  const [nestedByCode, setNestedByCode] = useState(new Map()); // code -> questions[] | 'loading'

  useEffect(() => {
    getSites().then(s => {
      setSites(s);
      if (s.length) setSiteId(s[0].id);
    }).finally(() => setLoading(false));
    getPoints().then(pts => setPointsByCode(new Map(pts.map(p => [p.point_code.trim(), p]))));
  }, []);

  useEffect(() => {
    if (!siteId) return;
    setRouteFilter('');
    setLoadingDetail(true);
    Promise.all([getRoutes({ site_id: siteId }), getAllRoutePoints()]).then(async ([r, allPoints]) => {
      setRoutes(r);
      // One bulk points-by-route call above, then one bulk
      // questions-by-point call per route below -- replaces what used to
      // be a request per route plus a nested request per point on that
      // route (thousands of concurrent requests tenant-wide), which was
      // slow enough that some individual requests genuinely failed and,
      // once caught, silently rendered as "no points/questions assigned"
      // even though the data existed.
      const entries = await Promise.all(r.map(async route => {
        const pts = allPoints[route.id] ?? [];
        const questionsByPoint = await getRoutePointQuestionsAll(route.id).catch(() => ({}));
        const withQuestions = pts.map(p => ({
          point: p.point,
          questions: questionsByPoint[p.point_id] ?? [],
        }));
        return [route.id, withQuestions];
      }));
      setData(Object.fromEntries(entries));
    }).finally(() => setLoadingDetail(false));
  }, [siteId]);

  // Discover every point-code jump target reachable from what's currently
  // visible (site/route/SOP-only filters already applied), fetch each one's
  // checklist (getPointAllQuestions -- the same cross-route lookup the PDA
  // Emulator uses for clone-jump destinations), then repeat on whatever NEW
  // point-code jumps those checklists themselves contain -- a nested SOP
  // routinely jumps to another SOP. Capped on both rounds and total points
  // fetched so a real cycle (SOP A -> SOP B -> SOP A) or a huge chain can't
  // fetch forever; renderQuestionRows' `visited` set is the actual cycle
  // guard, this cap is just a backstop.
  useEffect(() => {
    if (!expandNested) return;
    let cancelled = false;

    async function discoverAndFetch() {
      const visibleRoutes = routes.filter(r => !routeFilter || r.id === routeFilter);
      let frontier = new Set();
      for (const route of visibleRoutes) {
        const pts = (data[route.id] ?? []).filter(entry =>
          !sopOnly || entry.questions.some(q => q.question?.question_type === '9')
        );
        for (const { questions } of pts) {
          for (const q of questions) {
            for (const raw of [q.jump1, q.jump2, q.jump3, q.jump4, q.jump5]) {
              const c = classifyJump(raw);
              if (c.type === 'point') frontier.add(c.code);
            }
          }
        }
      }

      const seen = new Set();
      let round = 0;
      while (frontier.size > 0 && round < 6 && seen.size < 300) {
        const codes = [...frontier].filter(c => !seen.has(c));
        frontier = new Set();
        if (codes.length === 0) break;
        codes.forEach(c => seen.add(c));

        setNestedByCode(prev => {
          const next = new Map(prev);
          codes.forEach(c => { if (!next.has(c)) next.set(c, 'loading'); });
          return next;
        });

        const results = await Promise.all(codes.map(async code => {
          try { return [code, await getPointAllQuestions(code)]; }
          catch { return [code, []]; }
        }));
        if (cancelled) return;

        setNestedByCode(prev => {
          const next = new Map(prev);
          results.forEach(([code, qs]) => next.set(code, qs));
          return next;
        });

        for (const [, qs] of results) {
          for (const q of qs) {
            for (const raw of [q.jump1, q.jump2, q.jump3, q.jump4, q.jump5]) {
              const c = classifyJump(raw);
              if (c.type === 'point' && !seen.has(c.code)) frontier.add(c.code);
            }
          }
        }
        round++;
      }
    }

    discoverAndFetch();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandNested, data, sopOnly, routeFilter, routes]);

  // Renders one point's checklist as <tr> rows, recursively expanding any
  // point-code jump (when expandNested is on) right beneath the row that
  // jumps to it. `visited` carries the chain of point codes already shown
  // on this branch -- a jump back to one of them is a real cycle, so it's
  // named but not re-expanded, instead of recursing forever.
  function renderQuestionRows(qs, visited, colSpan) {
    const seqnoToDesc = new Map(qs.map(q => [String(q.seqno), q.question?.description]));
    const rows = [];
    for (const q of qs) {
      rows.push(
        <tr key={q.id}>
          <td>{q.seqno}</td>
          <td>{q.question?.description ?? '—'}</td>
          <td>{TYPE_LABEL[q.question?.question_type] ?? '—'}</td>
          <td>{q.answer_required === 'Y' ? 'Y' : ''}</td>
          <td>{jumpText(q.jump1, seqnoToDesc, pointsByCode)}</td>
          <td>{jumpText(q.jump2, seqnoToDesc, pointsByCode)}</td>
          <td>{jumpText(q.jump3, seqnoToDesc, pointsByCode)}</td>
          <td>{jumpText(q.jump4, seqnoToDesc, pointsByCode)}</td>
          <td>{jumpText(q.jump5, seqnoToDesc, pointsByCode)}</td>
        </tr>
      );
      if (!expandNested) continue;
      for (const raw of [q.jump1, q.jump2, q.jump3, q.jump4, q.jump5]) {
        const c = classifyJump(raw);
        if (c.type !== 'point') continue;
        if (visited.has(c.code)) {
          rows.push(
            <tr key={`${q.id}-cycle-${c.code}`}>
              <td colSpan={colSpan} className={styles.empty}>↳ {c.code} — already shown above this chain, not repeated</td>
            </tr>
          );
          continue;
        }
        rows.push(renderNestedBlock(c.code, visited, colSpan, `${q.id}-${c.code}`));
      }
    }
    return rows;
  }

  function renderNestedBlock(pointCode, visited, colSpan, key) {
    const point = pointsByCode.get(pointCode);
    const qs = nestedByCode.get(pointCode);
    const nextVisited = new Set(visited);
    nextVisited.add(pointCode);
    return (
      <tr key={key}>
        <td colSpan={colSpan} style={{ background: '#f8f9fb', padding: '6px 10px 6px 24px', borderTop: '1px dashed #ccc' }}>
          <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: 4 }}>
            ↳ SOP: {pointCode}{point ? ` — ${point.description}` : ''}
          </div>
          {!qs || qs === 'loading' ? (
            <div className={styles.empty}>Loading…</div>
          ) : qs.length === 0 ? (
            <div className={styles.empty}>No questions found for this point</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr><th>Seq</th><th>Question</th><th>Type</th><th>Req</th><th>Jump 1</th><th>Jump 2</th><th>Jump 3</th><th>Jump 4</th><th>Jump 5</th></tr>
              </thead>
              <tbody>{renderQuestionRows(qs, nextVisited, colSpan)}</tbody>
            </table>
          )}
        </td>
      </tr>
    );
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  // The SOP-only filter first, then Find and Sort. A route whose own
  // name/code matches Find keeps all its points; otherwise a point is kept if
  // its code/description or any of its question descriptions match. A kept
  // point always shows its whole question list, since the jumps only make
  // sense in context.
  function viewRoute(route) {
    const all = (data[route.id] ?? []).filter(entry =>
      !sopOnly || entry.questions.some(q => q.question?.question_type === '9')
    );
    const routeMatch = matchesFind(view.find, route.name, route.route_code);
    const pts = findAndSort(
      all, view,
      e => [e.point?.point_code, e.point?.description, ...e.questions.map(q => q.question?.description)],
      (e, key) => ({ point_code: e.point?.point_code, description: e.point?.description, questions: e.questions.length })[key],
      routeMatch,
    );
    return { all, pts, show: !view.find.trim() || routeMatch || pts.length > 0 };
  }

  function handleExport() {
    const headers = ['Route', 'Route Code', 'Point Code', 'Description', 'Seq', 'Question', 'Type', 'Req', 'Jump 1', 'Jump 2', 'Jump 3', 'Jump 4', 'Jump 5'];
    const rows = routes
      .filter(r => (!routeFilter || r.id === routeFilter) && viewRoute(r).show)
      .flatMap(route => {
        const { pts } = viewRoute(route);
        return pts.flatMap(({ point, questions }) => {
          if (questions.length === 0) {
            return [[route.name, route.route_code, point?.point_code || '', point?.description || '', '', '', '', '', '', '', '', '', '']];
          }
          const seqnoToDesc = new Map(questions.map(q => [String(q.seqno), q.question?.description]));
          return questions.map(q => [
            route.name, route.route_code, point?.point_code || '', point?.description || '',
            q.seqno ?? '', q.question?.description ?? '', TYPE_LABEL[q.question?.question_type] ?? '',
            q.answer_required === 'Y' ? 'Y' : '',
            jumpText(q.jump1, seqnoToDesc, pointsByCode), jumpText(q.jump2, seqnoToDesc, pointsByCode),
            jumpText(q.jump3, seqnoToDesc, pointsByCode), jumpText(q.jump4, seqnoToDesc, pointsByCode),
            jumpText(q.jump5, seqnoToDesc, pointsByCode),
          ]);
        });
      });
    downloadCsv('route-setup-with-questions', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Route Setup w/ Questions" subtitle="Routes, points, and their assigned questions" onExport={handleExport} />
      <div className={styles.meta}>Generated {now}</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Site</label>
          <select className={styles.filterSelect} value={siteId} onChange={e => setSiteId(e.target.value)}>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Route</label>
          <select className={styles.filterSelect} value={routeFilter} onChange={e => setRouteFilter(e.target.value)}>
            <option value="">All Routes</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name} — {r.route_code}</option>)}
          </select>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={sopOnly} onChange={e => setSopOnly(e.target.checked)} />
          SOP only (points with a Clone Jump question) — matches legacy "SOP Setup w/ Questions"
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={expandNested} onChange={e => setExpandNested(e.target.checked)} />
          Show nested SOP questions (expand each Clone Jump's destination checklist inline)
        </label>
        <FindSortBar
          find={view.find} onFind={view.setFind} placeholder="Route, point or question…"
          sortKey={view.sortKey} onSortKey={view.setSortKey}
          sortDir={view.sortDir} onSortDir={view.setSortDir}
          sortOptions={SORT_OPTIONS}
        />
      </div>

      {loadingDetail ? <div className={styles.loading}>Loading route detail…</div> : routes.filter(r => !routeFilter || r.id === routeFilter).map(route => {
        const { all, pts, show } = viewRoute(route);
        if ((sopOnly && all.length === 0) || !show) return null;
        return (
          <div className={styles.section} key={route.id}>
            <h3 className={styles.sectionTitle}>{route.name} — {route.route_code}</h3>
            {pts.length === 0 ? (
              <div className={styles.empty}>{all.length === 0 ? 'No points assigned' : 'No points match'}</div>
            ) : pts.map(({ point, questions }) => (
              <div key={point?.id ?? Math.random()} style={{ marginBottom: 14 }}>
                <div
                  className={styles.subTitle}
                  onDoubleClick={() => point && navigate(`/setup/routes/${route.id}/points/${point.id}/questions`)}
                  style={point ? { cursor: 'pointer' } : undefined}
                  title={point ? 'Double-click to edit this point’s questions' : undefined}
                >
                  {point?.point_code} — {point?.description}
                </div>
                {questions.length === 0 ? (
                  <div className={styles.empty}>No questions assigned</div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Seq</th><th>Question</th><th>Type</th><th>Req</th><th>Jump 1</th><th>Jump 2</th><th>Jump 3</th><th>Jump 4</th><th>Jump 5</th></tr>
                    </thead>
                    <tbody>
                      {renderQuestionRows(questions, new Set([point?.point_code?.trim()]), 9)}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        );
      })}
      <ReportFooter />
    </div>
  );
}
