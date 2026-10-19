import { useEffect, useState } from 'react';
import { getIncidents, getIncidentSub1, getIncidentSub2, getIncidentSub3 } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import FindSortBar from '../components/FindSortBar';
import { downloadCsv } from '../utils/exportCsv';
import { useFindSort, matchesFind, compareValues } from '../utils/reportView';
import styles from './Report.module.css';

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'code', label: 'Code' },
];

// Levels below an incident type, top-down.
const CHILD_KEYS = ['sub1', 'sub2', 'sub3'];

function sopBadge(item) {
  return item.has_sop_questions === 'Y' ? ` — SOP → ${item.sop_jump_point || '?'}` : '';
}

// Keeps a node if it matches Find (with its whole subtree) or any descendant
// does (with just the matching branches).
function findInTree(node, keys, find) {
  if (!find.trim() || matchesFind(find, node.name, node.code)) return node;
  const key = keys[0];
  if (!key) return null;
  const kids = node[key].map(k => findInTree(k, keys.slice(1), find)).filter(Boolean);
  return kids.length ? { ...node, [key]: kids } : null;
}

// Sorts siblings at every level by the chosen field.
function sortTree(nodes, keys, sortKey, sortDir) {
  const sorted = [...nodes].sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir));
  const key = keys[0];
  if (!key) return sorted;
  return sorted.map(n => ({ ...n, [key]: sortTree(n[key], keys.slice(1), sortKey, sortDir) }));
}

export default function IncidentReport() {
  const view = useFindSort('name');
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState([]);
  const [masterFilter, setMasterFilter] = useState('');
  const [sopOnly, setSopOnly] = useState(false);

  useEffect(() => {
    getIncidents().then(async masters => {
      const full = await Promise.all(masters.map(async m => {
        const sub1s = await getIncidentSub1(m.id);
        const sub1Full = await Promise.all(sub1s.map(async s1 => {
          const sub2s = await getIncidentSub2(s1.id);
          const sub2Full = await Promise.all(sub2s.map(async s2 => {
            const sub3s = await getIncidentSub3(s2.id);
            return { ...s2, sub3: sub3s };
          }));
          return { ...s1, sub2: sub2Full };
        }));
        return { ...m, sub1: sub1Full };
      }));
      setTree(full);
    }).finally(() => setLoading(false));
  }, []);

  // SOP-only: keep a node if it (or any descendant) has Build-SOP configured.
  const hasSop = item => item.has_sop_questions === 'Y';
  const searched = tree
    .filter(m => !masterFilter || m.id === masterFilter)
    .map(m => findInTree(m, CHILD_KEYS, view.find))
    .filter(Boolean);
  const visibleTree = sortTree(searched, CHILD_KEYS, view.sortKey, view.sortDir)
    .map(m => ({
      ...m,
      sub1: m.sub1
        .map(s1 => ({
          ...s1,
          sub2: s1.sub2
            .map(s2 => ({ ...s2, sub3: s2.sub3.filter(s3 => !sopOnly || hasSop(s3)) }))
            .filter(s2 => !sopOnly || hasSop(s2) || s2.sub3.length > 0),
        }))
        .filter(s1 => !sopOnly || hasSop(s1) || s1.sub2.length > 0),
    }))
    .filter(m => !sopOnly || hasSop(m) || m.sub1.length > 0);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();
  const totalSub1 = visibleTree.reduce((n, m) => n + m.sub1.length, 0);
  const totalSub2 = visibleTree.reduce((n, m) => n + m.sub1.reduce((n2, s1) => n2 + s1.sub2.length, 0), 0);
  const totalSub3 = visibleTree.reduce((n, m) => n + m.sub1.reduce((n2, s1) => n2 + s1.sub2.reduce((n3, s2) => n3 + s2.sub3.length, 0), 0), 0);

  function sopCols(item) {
    return [item?.has_sop_questions === 'Y' ? 'Y' : '', item?.sop_jump_point || ''];
  }

  function handleExport() {
    const headers = [
      'Incident', 'Incident Code', 'SOP', 'SOP Point',
      'Sub Cat 1', 'Sub Cat 1 Code', 'SOP', 'SOP Point',
      'Sub Cat 2', 'Sub Cat 2 Code', 'SOP', 'SOP Point',
      'Sub Cat 3', 'Sub Cat 3 Code', 'SOP', 'SOP Point',
    ];
    const rows = [];
    for (const m of visibleTree) {
      if (m.sub1.length === 0) {
        rows.push([m.name, m.code, ...sopCols(m), '', '', '', '', '', '', '', '', '', '', '', '']);
        continue;
      }
      for (const s1 of m.sub1) {
        if (s1.sub2.length === 0) {
          rows.push([m.name, m.code, ...sopCols(m), s1.name, s1.code, ...sopCols(s1), '', '', '', '', '', '', '', '']);
          continue;
        }
        for (const s2 of s1.sub2) {
          if (s2.sub3.length === 0) {
            rows.push([m.name, m.code, ...sopCols(m), s1.name, s1.code, ...sopCols(s1), s2.name, s2.code, ...sopCols(s2), '', '', '', '']);
            continue;
          }
          for (const s3 of s2.sub3) {
            rows.push([m.name, m.code, ...sopCols(m), s1.name, s1.code, ...sopCols(s1), s2.name, s2.code, ...sopCols(s2), s3.name, s3.code, ...sopCols(s3)]);
          }
        }
      }
    }
    downloadCsv('incident-activity', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Incident / Activity" subtitle="Full incident type hierarchy" onExport={handleExport} />
      <div className={styles.meta}>
        Generated {now} — {visibleTree.length} incident types, {totalSub1} sub-cat 1, {totalSub2} sub-cat 2, {totalSub3} sub-cat 3
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Incident</label>
          <select className={styles.filterSelect} value={masterFilter} onChange={e => setMasterFilter(e.target.value)}>
            <option value="">All Incidents</option>
            {tree.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={sopOnly} onChange={e => setSopOnly(e.target.checked)} />
          SOP only (items with Build SOP configured)
        </label>
        <FindSortBar
          find={view.find} onFind={view.setFind} placeholder="Incident name or code…"
          sortKey={view.sortKey} onSortKey={view.setSortKey}
          sortDir={view.sortDir} onSortDir={view.setSortDir}
          sortOptions={SORT_OPTIONS}
        />
      </div>

      {visibleTree.map(m => (
        <div className={styles.section} key={m.id}>
          <h3 className={styles.sectionTitle}>{m.name} ({m.code}){sopBadge(m)}</h3>
          {m.sub1.length === 0 ? <div className={styles.empty}>No sub-categories</div> : (
            <table className={styles.table}>
              <thead>
                <tr><th style={{ width: '30%' }}>Sub Category 1</th><th style={{ width: '30%' }}>Sub Category 2</th><th>Sub Category 3</th></tr>
              </thead>
              <tbody>
                {m.sub1.flatMap(s1 => {
                  const s1Label = `${s1.name} (${s1.code})${sopBadge(s1)}`;
                  if (s1.sub2.length === 0) {
                    return [<tr key={s1.id}><td>{s1Label}</td><td colSpan={2} style={{ color: '#999' }}>—</td></tr>];
                  }
                  return s1.sub2.flatMap((s2, i2) => {
                    const s2Label = `${s2.name} (${s2.code})${sopBadge(s2)}`;
                    if (s2.sub3.length === 0) {
                      return [
                        <tr key={s2.id}>
                          {i2 === 0 ? <td rowSpan={s1.sub2.length}>{s1Label}</td> : null}
                          <td>{s2Label}</td><td style={{ color: '#999' }}>—</td>
                        </tr>,
                      ];
                    }
                    return s2.sub3.map((s3, i3) => (
                      <tr key={s3.id}>
                        {i2 === 0 && i3 === 0 ? <td rowSpan={s1.sub2.reduce((n, x) => n + Math.max(x.sub3.length, 1), 0)}>{s1Label}</td> : null}
                        {i3 === 0 ? <td rowSpan={Math.max(s2.sub3.length, 1)}>{s2Label}</td> : null}
                        <td>{s3.name} ({s3.code}){sopBadge(s3)}</td>
                      </tr>
                    ));
                  });
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <ReportFooter />
    </div>
  );
}
