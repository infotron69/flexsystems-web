import { useEffect, useState } from 'react';
import { getSites, getRoutes, getAllRoutePoints, getRoutePointQuestionsAll } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import { downloadCsv } from '../utils/exportCsv';
import styles from './Report.module.css';

const TYPE_LABEL = {
  '1': 'YES/NO', '2': 'MULTICHOICE', '3': 'ALPHA/NUM', '4': 'LOW/NORMAL/HIGH',
  '5': 'MULTISELECT', '6': 'SHOWFILE', '7': 'ASSET SCAN', '8': 'PICKLIST',
  '9': 'CLONE JUMP', '10': 'SIGNATURE', '11': 'PHOTO',
};

export default function RouteQuestionsReport() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [routes, setRoutes] = useState([]);
  const [data, setData] = useState({}); // routeId -> [{point, questions}]
  const [sopOnly, setSopOnly] = useState(false);
  const [routeFilter, setRouteFilter] = useState('');

  useEffect(() => {
    getSites().then(s => {
      setSites(s);
      if (s.length) setSiteId(s[0].id);
    }).finally(() => setLoading(false));
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

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  function handleExport() {
    const headers = ['Route', 'Route Code', 'Point Code', 'Description', 'Seq', 'Question', 'Type', 'Req', 'Jump 1', 'Jump 2', 'Jump 3', 'Jump 4', 'Jump 5'];
    const rows = routes
      .filter(r => !routeFilter || r.id === routeFilter)
      .flatMap(route => {
        const pts = (data[route.id] ?? []).filter(entry =>
          !sopOnly || entry.questions.some(q => q.question?.question_type === '9')
        );
        return pts.flatMap(({ point, questions }) => {
          if (questions.length === 0) {
            return [[route.name, route.route_code, point?.point_code || '', point?.description || '', '', '', '', '', '', '', '', '', '']];
          }
          return questions.map(q => [
            route.name, route.route_code, point?.point_code || '', point?.description || '',
            q.seqno ?? '', q.question?.description ?? '', TYPE_LABEL[q.question?.question_type] ?? '',
            q.answer_required === 'Y' ? 'Y' : '', q.jump1 || '', q.jump2 || '', q.jump3 || '', q.jump4 || '', q.jump5 || '',
          ]);
        });
      });
    downloadCsv('route-setup-with-questions', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Route Setup w/ Questions" subtitle="Routes, points, and their assigned questions" backTo="/setup/reports" onExport={handleExport} />
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
      </div>

      {loadingDetail ? <div className={styles.loading}>Loading route detail…</div> : routes.filter(r => !routeFilter || r.id === routeFilter).map(route => {
        const pts = (data[route.id] ?? []).filter(entry =>
          !sopOnly || entry.questions.some(q => q.question?.question_type === '9')
        );
        if (sopOnly && pts.length === 0) return null;
        return (
          <div className={styles.section} key={route.id}>
            <h3 className={styles.sectionTitle}>{route.name} — {route.route_code}</h3>
            {pts.length === 0 ? (
              <div className={styles.empty}>No points assigned</div>
            ) : pts.map(({ point, questions }) => (
              <div key={point?.id ?? Math.random()} style={{ marginBottom: 14 }}>
                <div className={styles.subTitle}>{point?.point_code} — {point?.description}</div>
                {questions.length === 0 ? (
                  <div className={styles.empty}>No questions assigned</div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Seq</th><th>Question</th><th>Type</th><th>Req</th><th>Jump 1</th><th>Jump 2</th><th>Jump 3</th><th>Jump 4</th><th>Jump 5</th></tr>
                    </thead>
                    <tbody>
                      {questions.map(q => (
                        <tr key={q.id}>
                          <td>{q.seqno}</td>
                          <td>{q.question?.description ?? '—'}</td>
                          <td>{TYPE_LABEL[q.question?.question_type] ?? '—'}</td>
                          <td>{q.answer_required === 'Y' ? 'Y' : ''}</td>
                          <td>{q.jump1 || '—'}</td>
                          <td>{q.jump2 || '—'}</td>
                          <td>{q.jump3 || '—'}</td>
                          <td>{q.jump4 || '—'}</td>
                          <td>{q.jump5 || '—'}</td>
                        </tr>
                      ))}
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
