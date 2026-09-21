import { useEffect, useState, useMemo } from 'react';
import { getRoutePoints, getRoutePointQuestions, getRoutePointQuestionsAll, getPoints, sopLookupAll, getAllJumpTargets, updatePoint } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import { downloadCsv } from '../utils/exportCsv';
import { jumpLabels } from './pointQuestionsShared';
import { buildFlowGraph, graphToMermaid } from '../utils/sopFlowchart';
import Modal from '../components/Modal';
import MermaidDiagram from '../components/MermaidDiagram';
import styles from './Report.module.css';

const SOP_ROUTE_ID = 'Incidents1';

// Recursively walking the jump graph could in theory blow up (a MULTICHOICE
// with several branches whose targets are themselves MULTICHOICE...) -- these
// caps keep a single top-level question's tree bounded and printable.
const MAX_CHAIN_DEPTH = 12;
const MAX_CHAIN_NODES = 150;

// Builds the full downstream tree for one question: every configured answer,
// and what answering it actually leads to -- followed recursively (same
// convention as the question grid: a numeric jump = position in the current
// point's own list, a point code = that other point's own checklist, from
// its first question) all the way to a terminal step (Exit Point/Route, Log
// Incident, Repeat Scan) or back around into something already shown above.
function buildBranchTree(rpq, questionsInList, questionsByPoint, pointDescByCode, visited, depth, counter) {
  if (depth > MAX_CHAIN_DEPTH || counter.count > MAX_CHAIN_NODES) return [];
  const labels = jumpLabels(rpq.question);
  const jumps = [rpq.jump1, rpq.jump2, rpq.jump3, rpq.jump4, rpq.jump5];
  const nodes = [];

  for (let i = 0; i < 5; i++) {
    const label = labels[i];
    const raw = jumps[i];
    if (label === null || !raw || raw === '') continue;
    const v = raw.trim();
    counter.count += 1;
    if (counter.count > MAX_CHAIN_NODES) { nodes.push({ label, text: '… (too many steps to show)', children: [] }); break; }

    if (v === '0')       { nodes.push({ label, text: 'Exit Point (checklist ends here)', children: [] }); continue; }
    if (v === '98')      { nodes.push({ label, text: 'Log an Incident', children: [] }); continue; }
    if (v === '99')      { nodes.push({ label, text: 'Exit Route (patrol ends here)', children: [] }); continue; }
    if (v === '97')      { nodes.push({ label, text: 'Repeat Last Scan', children: [] }); continue; }
    if (v === '96')      { nodes.push({ label, text: 'Repeat Last Scan + Photo', children: [] }); continue; }

    let target, targetList;
    if (/^\d{1,4}$/.test(v)) {
      target = questionsInList[parseInt(v, 10) - 1];
      targetList = questionsInList;
    } else {
      targetList = questionsByPoint[v] || [];
      target = targetList[0];
      if (!target) { nodes.push({ label, text: `Go to: ${pointDescByCode[v] || v}`, children: [] }); continue; }
    }

    if (!target) { nodes.push({ label, text: `Continue to Question ${v}`, children: [] }); continue; }

    const desc = target.question?.description ?? '—';
    if (visited.has(target.id)) {
      nodes.push({ label, text: `Continue to: ${desc} (loops back — see above)`, children: [] });
      continue;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(target.id);
    nodes.push({
      label,
      text: `Continue to: ${desc}`,
      children: buildBranchTree(target, targetList, questionsByPoint, pointDescByCode, nextVisited, depth + 1, counter),
    });
  }
  return nodes;
}

function BranchTree({ nodes }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <ul className={styles.sopBranchList}>
      {nodes.map((n, i) => (
        <li key={i}>
          {n.label} → {n.text}
          <BranchTree nodes={n.children} />
        </li>
      ))}
    </ul>
  );
}

// Flattened, indented text version of the same tree, for the CSV cell.
function flattenTree(nodes, indent = 1) {
  if (!nodes || nodes.length === 0) return [];
  const pad = '  '.repeat(indent);
  return nodes.flatMap(n => [
    `${pad}${n.label} → ${n.text}`,
    ...flattenTree(n.children, indent + 1),
  ]);
}

// Local draft state while typing, saved only on blur (and only if actually
// changed) -- saving on every keystroke would fire an API call per
// character and fight the cursor when the parent's value prop updates.
// Callers key this by `value` so a save-triggered prop change remounts it
// (resetting the draft) instead of needing an effect to resync state.
function EditableCell({ value, onSave, placeholder }) {
  const [draft, setDraft] = useState(value || '');
  return (
    <input
      className={styles.sopCategoryInput}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        // Matches this app's convention of storing free-typed text in caps
        // (the CSS uppercase rule is display-only) -- category/sub-category
        // are new free-text fields, same as description/name elsewhere.
        const trimmed = draft.trim().toUpperCase();
        if (trimmed !== (value || '')) onSave(trimmed);
      }}
    />
  );
}

export default function SopMaintReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [referencedBy, setReferencedBy] = useState({});
  const [jumpTargets, setJumpTargets] = useState(() => new Set()); // point codes reachable via a route/point jump, anywhere
  const [questionsByPoint, setQuestionsByPoint] = useState({}); // point_id -> RoutePointQuestion[]
  const [pointDescByCode, setPointDescByCode] = useState({}); // point_code (trimmed) -> description, for resolving jump targets
  const [search, setSearch] = useState('');
  const [onlyUnused, setOnlyUnused] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [sortKey, setSortKey] = useState('description');
  const [sortDir, setSortDir] = useState('asc');
  const [flowchartFor, setFlowchartFor] = useState(null); // the RoutePointSetup row currently shown in the flow chart modal
  const [flowResult, setFlowResult] = useState(null); // { forId, graph } -- set only once the async build resolves
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // point codes with their question detail expanded
  const [expandOnPrint, setExpandOnPrint] = useState(true); // force every row open before printing -- suppress to print only what's currently expanded

  useEffect(() => {
    Promise.all([getRoutePoints(SOP_ROUTE_ID), sopLookupAll(), getPoints(), getAllJumpTargets(), getRoutePointQuestionsAll(SOP_ROUTE_ID)])
      .then(([rps, lookup, allPoints, jumpCodes, questionsByPointId]) => {
        const withPoint = rps.filter(rp => rp.point);
        setRows(withPoint);
        setReferencedBy(lookup);
        setJumpTargets(new Set(jumpCodes.map(c => c.trim())));
        setPointDescByCode(Object.fromEntries(allPoints.map(p => [p.point_code.trim(), p.description])));
        setQuestionsByPoint(questionsByPointId);
      })
      .finally(() => setLoading(false));
  }, []);

  // Builds the flow-chart graph on demand, fetching any point along the way
  // that wasn't part of the initial bulk load, so the diagram can keep
  // following the checklist all the way to a real end instead of stopping
  // at "Go to: <point>" just because that point wasn't pre-fetched.
  useEffect(() => {
    if (!flowchartFor) return;
    let cancelled = false;
    const forId = flowchartFor.point_id;
    const qs = questionsByPoint[forId.trim()] ?? [];
    buildFlowGraph(qs[0], qs, questionsByPoint, pointDescByCode, pid => getRoutePointQuestions(SOP_ROUTE_ID, pid))
      .then(graph => {
        if (cancelled) return;
        setFlowResult({ forId, graph });
        if (graph.fetchedPoints.size > 0) {
          setQuestionsByPoint(prev => {
            const next = { ...prev };
            for (const [pid, fetchedQs] of graph.fetchedPoints) {
              if (!(pid in next)) next[pid] = fetchedQs;
            }
            return next;
          });
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowchartFor]);

  // "In use" now means referenced by an incident OR reachable as a jump
  // target from any route's checklist -- a SOP point only counts as truly
  // Unused if neither points at it.
  function isUsed(rp) {
    return !!referencedBy[rp.point.point_code] || jumpTargets.has(rp.point.point_code.trim());
  }

  function sortValue(rp, key) {
    switch (key) {
      case 'id': return rp.point.point_code;
      case 'description': return rp.point.description;
      case 'referencedBy': {
        const usedBy = referencedBy[rp.point.point_code];
        if (usedBy) return usedBy;
        return jumpTargets.has(rp.point.point_code.trim()) ? 'In Use' : 'Unused';
      }
      case 'questions': return (questionsByPoint[rp.point_id.trim()] ?? []).length;
      case 'category': return rp.point.category || '';
      case 'subCategory': return rp.point.sub_category || '';
      default: return '';
    }
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
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir, referencedBy, jumpTargets, questionsByPoint]);

  // Sub-Category options narrow to whatever co-occurs with the chosen
  // Category, same cascading behavior as Route Setup's point-picker filters.
  const categoryOptions = useMemo(
    () => [...new Set(rows.map(rp => rp.point.category).filter(Boolean))].sort(),
    [rows]
  );
  const subCategoryOptions = useMemo(
    () => [...new Set(
      rows
        .filter(rp => !filterCategory || rp.point.category === filterCategory)
        .map(rp => rp.point.sub_category)
        .filter(Boolean)
    )].sort(),
    [rows, filterCategory]
  );

  const filteredRows = useMemo(() => {
    const lc = search.trim().toLowerCase();
    return sorted.filter(rp => {
      if (!showHidden && rp.point.is_hidden === 'Y') return false;
      if (onlyUnused && isUsed(rp)) return false;
      if (filterCategory && rp.point.category !== filterCategory) return false;
      if (filterSubCategory && rp.point.sub_category !== filterSubCategory) return false;
      if (!lc) return true;
      return rp.point.description.toLowerCase().includes(lc) || rp.point.point_code.toLowerCase().includes(lc);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, search, onlyUnused, showHidden, filterCategory, filterSubCategory, referencedBy, jumpTargets]);

  const unusedCount = useMemo(
    () => sorted.filter(rp => !isUsed(rp)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted, referencedBy, jumpTargets]
  );

  const hiddenCount = useMemo(() => sorted.filter(rp => rp.point.is_hidden === 'Y').length, [sorted]);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  function toggleExpanded(pointCode) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(pointCode) ? next.delete(pointCode) : next.add(pointCode);
      return next;
    });
  }

  // Patches one point's field via the API, then updates the already-loaded
  // row in place -- avoids refetching all 139+ SOPs (and their question
  // lists) just to reflect a single category/hide edit.
  function savePointField(pointCode, field, value) {
    updatePoint(pointCode, { [field]: value }).then(updated => {
      setRows(prev => prev.map(rp => rp.point.point_code === pointCode
        ? { ...rp, point: { ...rp.point, ...updated } }
        : rp));
    });
  }

  function toggleHidden(rp) {
    const next = rp.point.is_hidden === 'Y' ? 'N' : 'Y';
    savePointField(rp.point.point_code, 'is_hidden', next);
  }

  // Building + rendering every row's branch tree at once (139 SOPs, some with
  // 10 questions and deep jump chains) is heavy enough to freeze the tab for
  // several seconds if done in one synchronous state update. Expanding in
  // small batches instead lets the browser paint between batches, so the
  // report stays responsive while it catches up. setTimeout rather than
  // requestAnimationFrame -- rAF callbacks can stall indefinitely on a
  // backgrounded tab (e.g. mid-print, if focus moves to the print dialog),
  // where a plain timer just gets throttled, not stopped.
  function expandAll() {
    const codes = filteredRows.map(rp => rp.point.point_code);
    const BATCH_SIZE = 20;
    return new Promise(resolve => {
      let i = 0;
      function step() {
        // Fix the range for THIS batch in its own bindings -- the updater
        // below may not actually run until after `i` has already been
        // advanced for the next batch, so it must not read the shared,
        // mutable `i` directly.
        const start = i;
        const end = Math.min(i + BATCH_SIZE, codes.length);
        setExpandedIds(prev => {
          const next = new Set(prev);
          for (let j = start; j < end; j++) next.add(codes[j]);
          return next;
        });
        i = end;
        if (i < codes.length) setTimeout(step, 0);
        else resolve();
      }
      setTimeout(step, 0);
    });
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  function handleExport() {
    const headers = ['ID', 'SOP Description', 'Referenced By', 'Questions'];
    const rows = filteredRows.map(rp => {
      const qs = questionsByPoint[rp.point_id.trim()] ?? [];
      const qList = qs.map((q, i) => {
        const tree = buildBranchTree(q, qs, questionsByPoint, pointDescByCode, new Set([q.id]), 0, { count: 0 });
        const branchLines = flattenTree(tree);
        const header = `${i + 1}. ${q.question?.description ?? '—'}${q.answer_required === 'Y' ? ' *' : ''}`;
        return branchLines.length ? [header, ...branchLines].join('\n') : header;
      }).join('\n');
      const usedBy = referencedBy[rp.point.point_code];
      const referencedText = usedBy ?? (jumpTargets.has(rp.point.point_code.trim()) ? 'In Use (route jump)' : 'Unused');
      return [rp.point.point_code, rp.point.description, referencedText, qList];
    });
    downloadCsv('sop-maintenance', headers, rows);
  }

  return (
    <div className={`${styles.page} ${styles.allowPageBreak}`}>
      <ReportHeader title="SOP Maintenance" subtitle="Standard Operating Procedure checklists and which incident references each one" backTo="/setup/reports" onExport={handleExport} onBeforePrint={expandOnPrint ? expandAll : undefined} />
      <div className={styles.meta}>
        Generated {now} — {filteredRows.length} of {rows.length} SOPs
        {unusedCount > 0 && <> — <strong className={styles.unusedMeta}>{unusedCount} not referenced by any incident or route</strong></>}
        {hiddenCount > 0 && <> — {hiddenCount} hidden</>}
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Search</label>
          <input className={styles.filterInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Description or ID contains…" />
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Category</label>
          <select
            className={styles.filterSelect}
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); setFilterSubCategory(''); }}
          >
            <option value="">All</option>
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
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>
            <input type="checkbox" checked={onlyUnused} onChange={e => setOnlyUnused(e.target.checked)} />
            {' '}Unused only
          </label>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
            {' '}Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </label>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>
            <input type="checkbox" checked={expandOnPrint} onChange={e => setExpandOnPrint(e.target.checked)} />
            {' '}Expand all questions when printing
          </label>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>&nbsp;</label>
          <div>
            <button className={styles.flowChartBtn} onClick={expandAll}>Expand All</button>
            {' '}
            <button className={styles.flowChartBtn} onClick={collapseAll}>Collapse All</button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sortHeader} onClick={() => toggleSort('id')}>
                ID{sortKey === 'id' && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className={styles.sortHeader} onClick={() => toggleSort('description')}>
                SOP Description{sortKey === 'description' && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className={styles.sortHeader} onClick={() => toggleSort('category')}>
                Category{sortKey === 'category' && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className={styles.sortHeader} onClick={() => toggleSort('subCategory')}>
                Sub-Category{sortKey === 'subCategory' && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className={styles.sortHeader} onClick={() => toggleSort('referencedBy')}>
                Referenced By{sortKey === 'referencedBy' && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th className={styles.sortHeader} onClick={() => toggleSort('questions')}>
                Questions <span className={styles.legendNote}>(* = Answer Required)</span>
                {sortKey === 'questions' && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
              <th>Visibility</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(rp => {
              const usedBy = referencedBy[rp.point.point_code];
              const usedByRoute = jumpTargets.has(rp.point.point_code.trim());
              const qs = questionsByPoint[rp.point_id.trim()] ?? [];
              const expanded = expandedIds.has(rp.point.point_code);
              const hidden = rp.point.is_hidden === 'Y';
              return (
                <tr key={rp.point.point_code} className={hidden ? styles.sopHiddenRow : undefined}>
                  <td className={styles.mono}>{rp.point.point_code}</td>
                  <td>{rp.point.description}</td>
                  <td>
                    <EditableCell
                      key={rp.point.category ?? ''}
                      value={rp.point.category}
                      placeholder="—"
                      onSave={v => savePointField(rp.point.point_code, 'category', v)}
                    />
                  </td>
                  <td>
                    <EditableCell
                      key={rp.point.sub_category ?? ''}
                      value={rp.point.sub_category}
                      placeholder="—"
                      onSave={v => savePointField(rp.point.point_code, 'sub_category', v)}
                    />
                  </td>
                  <td>
                    {usedBy ? usedBy
                      : usedByRoute ? <span className={styles.inUseBadge} title="Reachable as a jump target from a route's checklist, though no incident is wired to it">In Use</span>
                      : <span className={styles.unusedBadge}>Unused</span>}
                  </td>
                  <td>
                    {qs.length === 0 ? (
                      <span className={styles.empty}>No questions</span>
                    ) : (
                      <>
                        <button
                          className={styles.expandToggleBtn}
                          onClick={() => toggleExpanded(rp.point.point_code)}
                        >
                          {expanded ? '▾' : '▸'} {qs.length} question{qs.length === 1 ? '' : 's'}
                        </button>
                        <button className={styles.flowChartBtn} onClick={() => setFlowchartFor(rp)}>
                          ⚭ View Flow Chart
                        </button>
                        {expanded && (
                          <ol className={styles.sopQuestionList}>
                            {qs.map(q => {
                              const tree = buildBranchTree(q, qs, questionsByPoint, pointDescByCode, new Set([q.id]), 0, { count: 0 });
                              return (
                                <li key={q.id}>
                                  {q.question?.description ?? '—'}
                                  {q.answer_required === 'Y' && <span title="Answer required"> *</span>}
                                  <BranchTree nodes={tree} />
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <button className={styles.flowChartBtn} onClick={() => toggleHidden(rp)}>
                      {hidden ? 'Unhide' : 'Hide'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ReportFooter />

      {flowchartFor && (() => {
        const ready = flowResult && flowResult.forId === flowchartFor.point_id;
        return (
          <Modal
            title={`Flow Chart — ${flowchartFor.point.description}`}
            onClose={() => setFlowchartFor(null)}
            wide
          >
            {!ready ? (
              <div className={styles.empty}>Building diagram…</div>
            ) : (
              <>
                {flowResult.graph.truncated && (
                  <div className={styles.unusedMeta} style={{ marginBottom: 8 }}>
                    This checklist is large — the diagram stops at {flowResult.graph.nodes.length} steps.
                  </div>
                )}
                <MermaidDiagram definition={graphToMermaid(flowResult.graph)} />
              </>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}
