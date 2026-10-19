import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getRoute, getPoint,
  getRoutePoints, getRoutePointQuestions, getRoutePointQuestionCounts,
  getAllQuestions, replaceRoutePointQuestions,
  getPointsByCode, getPointAllQuestions,
} from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import useGoBack from '../hooks/useGoBack';
import { markPdaFilesDirty } from '../pdaDirty';
import {
  MAX_SLOTS, TYPE_LABEL, jumpLabels, isPointCode, jumpLabel, mkEmpty, rpqToSlot,
  JumpSelect, QuestionPicker,
} from './pointQuestionsShared';
import { buildFlowGraph, graphToMermaid } from '../utils/sopFlowchart';
import Modal from '../components/Modal';
import MermaidDiagram from '../components/MermaidDiagram';
import styles from './PointQuestions.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// ExpandedGrid — editable question grid for a jump destination point
// ─────────────────────────────────────────────────────────────────────────────
function ExpandedGrid({ dest, onFollow }) {
  const { code, point, questions: localQs } = dest;
  const navigate = useNavigate();
  // Every RoutePointQuestion row carries its own route_id -- so the route
  // this destination's checklist actually lives on is whatever its own
  // rows say, not assumed (a jump target is usually but not always an
  // Incidents1 SOP point). Only known once localQs has loaded with at
  // least one row.
  const destRouteId = localQs?.[0]?.route_id;

  return (
    <div className={styles.expandedSection} id={`dest-${code}`}>
      <div
        className={styles.expandedTitle}
        onDoubleClick={() => destRouteId && navigate(`/setup/routes/${destRouteId}/points/${code}/questions`)}
        style={destRouteId ? { cursor: 'pointer' } : undefined}
        title={destRouteId ? 'Double-click to edit this point’s questions' : undefined}
      >
        Following:&nbsp;
        <strong>{point?.point_code?.trim() ?? code}</strong>
        {point?.description && <> &ndash; {point.description}</>}
        <span className={styles.expandedReadOnlyNote}>view only — edit on its own point/route (double-click to open it)</span>
      </div>

      {localQs === null ? (
        <div className={styles.expandedLoading}>Loading…</div>
      ) : localQs.length === 0 ? (
        <div className={styles.expandedEmpty}>No questions for this point.</div>
      ) : (
        /* ── Read-only trace table. Point-code jumps are clickable to follow further. ── */
        <table className={styles.expandedTable}>
          <thead>
            <tr>
              <th>Seq</th><th>Question</th><th>Type</th>
              <th>J1</th><th>J2</th><th>J3</th><th>J4</th><th>J5</th>
            </tr>
          </thead>
          <tbody>
            {localQs.map(rpq => (
              <tr key={rpq.id}>
                <td>{rpq.seqno}</td>
                <td>{rpq.question?.description ?? '—'}</td>
                <td>{TYPE_LABEL[rpq.question?.question_type] ?? '—'}</td>
                {[rpq.jump1, rpq.jump2, rpq.jump3, rpq.jump4, rpq.jump5].map((jv, ji) => (
                  <td key={ji}>
                    {jv && isPointCode(jv) ? (
                      <button className={styles.followBtn} onClick={() => onFollow(jv.trim())}>
                        {jumpLabel(jv)} →
                      </button>
                    ) : (
                      jv ? jumpLabel(jv) : '—'
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// GET /points/{id}/questions returns a point's RoutePointQuestion rows across
// EVERY route it's allocated to, not one coherent checklist -- a point often
// carries an identical seqno=1, seqno=2... sequence independently on each of
// several routes, so naively using the flat result duplicates every row once
// per route. Group by route_id and keep only the fullest one, on the
// assumption that's the "real" configured checklist for this point.
function oneRouteWorth(rows) {
  if (!rows.length) return rows;
  const byRoute = new Map();
  for (const r of rows) {
    if (!byRoute.has(r.route_id)) byRoute.set(r.route_id, []);
    byRoute.get(r.route_id).push(r);
  }
  let best = [];
  for (const list of byRoute.values()) {
    if (list.length > best.length) best = list;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function PointQuestions() {
  const { routeId, pointId } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useCanEditSite();

  const [route,        setRoute]        = useState(null);
  // Back returns to wherever this editor was opened from (the route's point
  // list, SOP Maintenance, a report, another point's chain...); the parent
  // is only the fallback when there's no earlier page.
  const goBack = useGoBack(
    routeId === 'Incidents1' ? '/setup/sops'
      : route?.site_id ? `/setup/sites/${route.site_id}/routes` : '/setup/customers',
  );
  const [point,        setPoint]        = useState(null);
  const [routePoints,  setRoutePoints]  = useState([]);
  // Points on the special "Incidents1" route — legacy jump destinations for
  // SOP/clone points are always offered alongside the current route's points.
  const [incidentsRoutePoints, setIncidentsRoutePoints] = useState([]);
  const [allQuestions, setAllQuestions] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  // Grid state — always in edit mode
  const [slots,   setSlots]   = useState(() => Array.from({ length: MAX_SLOTS }, mkEmpty));
  const [saving,  setSaving]  = useState(false);
  const [dirty,   setDirty]   = useState(false);

  // Auto-expanded destinations
  const [expanded, setExpanded] = useState([]);
  // Point codes the user explicitly clicked "follow" on inside an expanded
  // trace (lets them chain multiple hops), on top of the ones auto-derived
  // from the current slots' jump values.
  const [manualCodes, setManualCodes] = useState([]);
  // point_id -> question count on this route -- only points with a checklist
  // already built are worth offering as a preload source.
  const [questionCounts, setQuestionCounts] = useState({});

  useEffect(() => {
    Promise.all([
      getRoute(routeId),
      getPoint(pointId),
      getRoutePoints(routeId),
      getRoutePointQuestions(routeId, pointId),
      getAllQuestions(),
      routeId === 'Incidents1' ? Promise.resolve([]) : getRoutePoints('Incidents1').catch(() => []),
      getRoutePointQuestionCounts(routeId).catch(() => ({})),
    ])
      .then(([r, p, rp, qs, aq, incRp, counts]) => {
        setRoute(r);
        setPoint(p);
        setRoutePoints(rp);
        setIncidentsRoutePoints(incRp);
        setAllQuestions(aq);
        setQuestionCounts(counts);

        // Initialise grid
        const initial = qs.map(rpqToSlot);
        while (initial.length < MAX_SLOTS) initial.push(mkEmpty());
        setSlots(initial);
        setDirty(false);

      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [routeId, pointId]);

  const questionsById = useMemo(() => {
    const m = {};
    allQuestions.forEach(q => { m[q.id] = q; });
    return m;
  }, [allQuestions]);

  // Sort order for every QuestionPicker on this screen -- one control feeds
  // all 10 rows rather than repeating a sort dropdown per row.
  const [questionSortMode, setQuestionSortMode] = useState('category'); // 'category' | 'description'

  const sortedQuestions = useMemo(() => {
    if (questionSortMode === 'description') {
      return [...allQuestions].sort((a, b) => a.description.localeCompare(b.description));
    }
    return [...allQuestions].sort((a, b) => {
      const catA = a.category ?? '', catB = b.category ?? '';
      if (catA !== catB) {
        if (!catA) return 1;
        if (!catB) return -1;
        return catA.localeCompare(catB);
      }
      const subA = a.subcategory ?? '', subB = b.subcategory ?? '';
      if (subA !== subB) {
        if (!subA) return 1;
        if (!subB) return -1;
        return subA.localeCompare(subB);
      }
      return a.description.localeCompare(b.description);
    });
  }, [allQuestions, questionSortMode]);

  const excludeIds = useMemo(() => new Set([pointId]), [pointId]);

  // ── Reactive expanded destinations ────────────────────────────────────────
  // Watches the live slots (not just saved data) so the expanded grids update
  // immediately when the user picks a point-code jump destination.
  useEffect(() => {
    if (!routePoints.length && !allQuestions.length) return;

    // Collect every unique point code referenced in ANY jump field of ANY slot,
    // plus any codes the user manually followed from within an expanded trace.
    const seen = new Set();
    const codes = [];
    slots.forEach(s => {
      s.jumps.forEach(jv => {
        if (isPointCode(jv)) {
          const c = jv.trim();
          if (!seen.has(c)) { seen.add(c); codes.push(c); }
        }
      });
    });
    manualCodes.forEach(c => {
      if (!seen.has(c)) { seen.add(c); codes.push(c); }
    });

    setExpanded(prev => {
      // Re-use already-loaded entries; seed new ones as loading
      const prevMap = new Map(prev.map(e => [e.code, e]));
      const next = codes.map(code => prevMap.get(code) ?? { code, point: null, questions: null });

      // Kick off async loads for entries not yet loaded
      next.forEach(entry => {
        if (entry.questions !== null) return;   // already loaded or loading

        const upd = patch => setExpanded(cur => {
          const n = [...cur];
          const i = n.findIndex(e => e.code === entry.code);
          if (i >= 0) n[i] = { ...n[i], ...patch };
          return n;
        });

        const same = routePoints.find(r => r.point?.point_code?.trim() === entry.code);
        if (same) {
          upd({ point: same.point });
          // A point allocated to this route isn't necessarily where its
          // checklist is configured -- fall back to its cross-route question
          // set if this route has none, same as the "else" branch below.
          getRoutePointQuestions(routeId, same.point_id)
            .then(q => q.length ? q : getPointAllQuestions(same.point_id).then(oneRouteWorth))
            .then(q => upd({ questions: q }))
            .catch(() => upd({ questions: [] }));
        } else {
          getPointsByCode(entry.code)
            .then(pts => {
              if (!pts.length) { upd({ questions: [] }); return; }
              upd({ point: pts[0] });
              getPointAllQuestions(pts[0].id)
                .then(oneRouteWorth)
                .then(q => upd({ questions: q }))
                .catch(() => upd({ questions: [] }));
            })
            .catch(() => upd({ questions: [] }));
        }
      });

      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, routePoints, routeId, manualCodes]);

  function followCode(code) {
    setManualCodes(prev => prev.includes(code) ? prev : [...prev, code]);
  }

  // ── Preload questions from another point on this route ─────────────────
  // Legacy convenience for points that share an identical checklist (e.g.
  // every fire-extinguisher point) -- copies the source point's entire slot
  // grid onto this one. Doesn't save by itself; the admin still reviews and
  // clicks Save, same as any other edit.
  const [preloading, setPreloading] = useState(false);

  async function preloadFrom(sourcePointId) {
    if (!sourcePointId) return;
    setPreloading(true);
    try {
      const qs = await getRoutePointQuestions(routeId, sourcePointId);
      const loaded = qs.map(rpqToSlot);
      while (loaded.length < MAX_SLOTS) loaded.push(mkEmpty());
      setSlots(loaded);
      setDirty(true);
    } catch {
      setError('Failed to preload questions from that point');
    } finally {
      setPreloading(false);
    }
  }

  function updateSlot(i, patch) {
    setSlots(prev => {
      const n = [...prev];
      n[i] = { ...n[i], ...patch };
      return n;
    });
    setDirty(true);
  }

  function clearSlot(i) {
    setSlots(prev => {
      const n = [...prev];
      n[i] = mkEmpty();
      return n;
    });
    setDirty(true);
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const payload = slots
        .filter(s => s.questionId != null)
        .map((s, i) => ({
          route_id:        Number(routeId),
          point_id:        Number(pointId),
          question_id:     s.questionId,
          seqno:           i + 1,
          answer_required: s.answerRequired ? 'Y' : 'N',
          jump1: s.jumps[0] || null,
          jump2: s.jumps[1] || null,
          jump3: s.jumps[2] || null,
          jump4: s.jumps[3] || null,
          jump5: s.jumps[4] || null,
        }));
      await replaceRoutePointQuestions(routeId, pointId, payload);
      setDirty(false);
      markPdaFilesDirty();
    } catch (err) {
      setError('Save failed: ' + (err.response?.data?.detail ?? err.message));
    } finally {
      setSaving(false);
    }
  }

  // ── Flow chart (same Mermaid diagram as the SOP Maintenance report, applied
  // to this route point's live grid so a jump chain can be previewed before
  // it's even saved) ─────────────────────────────────────────────────────────
  const pointDescByCode = useMemo(() => {
    const m = {};
    [...routePoints, ...incidentsRoutePoints].forEach(rp => {
      if (rp.point?.point_code) m[rp.point.point_code.trim()] = rp.point.description;
    });
    return m;
  }, [routePoints, incidentsRoutePoints]);

  // The live (possibly-unsaved) slot grid, reshaped into the RoutePointQuestion
  // shape buildFlowGraph expects -- so editing a jump updates the preview
  // immediately, without needing to save first.
  const currentList = useMemo(() => slots
    .filter(s => s.questionId != null)
    .map((s, i) => ({
      id: `local-${i}`,
      question: questionsById[s.questionId],
      answer_required: s.answerRequired ? 'Y' : 'N',
      jump1: s.jumps[0] || null,
      jump2: s.jumps[1] || null,
      jump3: s.jumps[2] || null,
      jump4: s.jumps[3] || null,
      jump5: s.jumps[4] || null,
    })), [slots, questionsById]);

  // Resolves a jump target's own question list on demand -- same route/point
  // vs Incidents1/other-point fallback the expanded-trace effect above uses.
  // A point allocated to this route isn't necessarily where its checklist is
  // configured (points get shared across routes) -- if the route-scoped
  // lookup comes back empty, fall back to the point's cross-route question
  // set (the same endpoint the Incidents1/other-point branches already use)
  // before concluding it's a genuine dead end.
  async function fetchPointQuestionsByCode(code) {
    const same = routePoints.find(r => r.point?.point_code?.trim() === code);
    if (same) {
      try {
        const qs = await getRoutePointQuestions(routeId, same.point_id);
        if (qs.length) return qs;
      } catch { /* fall through to the cross-route lookup below */ }
      try { return oneRouteWorth(await getPointAllQuestions(same.point_id)); } catch { return []; }
    }
    const inc = incidentsRoutePoints.find(r => r.point?.point_code?.trim() === code);
    if (inc) {
      try {
        const qs = await getRoutePointQuestions('Incidents1', inc.point_id);
        if (qs.length) return qs;
      } catch { /* fall through to the cross-route lookup below */ }
      try { return oneRouteWorth(await getPointAllQuestions(inc.point_id)); } catch { return []; }
    }
    try {
      const pts = await getPointsByCode(code);
      if (!pts.length) return [];
      return oneRouteWorth(await getPointAllQuestions(pts[0].id));
    } catch { return []; }
  }

  const [showFlowChart, setShowFlowChart] = useState(false);
  const [flowGraph, setFlowGraph] = useState(null);

  function openFlowChart() {
    setShowFlowChart(true);
    setFlowGraph(null);
    buildFlowGraph(currentList[0], currentList, { [pointId]: currentList }, pointDescByCode, fetchPointQuestionsByCode)
      .then(setFlowGraph);
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const filledCount = slots.filter(s => s.questionId != null).length;
  const editable = canEdit(route?.site_id, 'questions');

  return (
    <div className={styles.page}>

      {/* ── Header bar ── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={goBack}>← Back</button>
        {dirty && editable && (
          <button className={styles.saveBtn} onClick={saveAll} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <div className={styles.titleBlock}>
          <span className={styles.routeLabel}>{route?.name}</span>
          <span className={styles.arrow}>›</span>
          <span className={styles.pointLabel}>
            {point?.point_code?.trim()} — {point?.description}
          </span>
        </div>
        <div className={styles.headerActions}>
          {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
          <span className={styles.slotCount}>{filledCount} / {MAX_SLOTS}</span>
          <button className={styles.backBtn} onClick={openFlowChart} disabled={!currentList.length}>
            ⚭ Flow Chart
          </button>
          <button className={styles.backBtn} onClick={() => navigate('/setup/questions')}>
            Questions →
          </button>
          <button className={styles.backBtn} onClick={() => navigate('/setup/reports/route-questions')}>
            Print Report →
          </button>
          <button className={styles.backBtn} onClick={() => navigate(`/setup/pda-emulator/${routeId}/${pointId}`)}>
            📱 PDA Emulator →
          </button>
        </div>
      </div>

      {/* ── Preload from another point on this route ── */}
      {editable && (
      <div className={styles.preloadBar}>
        <label className={styles.preloadLabel}>Preload Questions from another Point on this Route:</label>
        <select
          className={styles.preloadSelect}
          value=""
          disabled={preloading}
          onChange={e => preloadFrom(e.target.value)}
        >
          <option value="">{preloading ? 'Loading…' : '— select a point —'}</option>
          {routePoints
            .filter(rp => rp.point_id !== pointId && rp.point?.point_code && questionCounts[rp.point_id] > 0)
            .sort((a, b) => a.point.point_code.localeCompare(b.point.point_code))
            .map(rp => (
              <option key={rp.point_id} value={rp.point_id}>
                {rp.point.point_code.trim()} – {rp.point.description}
              </option>
            ))}
        </select>
      </div>
      )}

      {/* ── Sort order for the Question picker in every row below ── */}
      <div className={styles.preloadBar}>
        <label className={styles.preloadLabel}>Sort Questions by:</label>
        <select
          className={styles.preloadSelect}
          value={questionSortMode}
          onChange={e => setQuestionSortMode(e.target.value)}
        >
          <option value="category">Category / Sub-Category</option>
          <option value="description">Description (A–Z)</option>
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Flat question grid ── */}
      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.thSeq}>#</th>
              <th className={styles.thQ}>Question</th>
              <th className={styles.thType}>Type</th>
              <th className={styles.thReq}>Req</th>
              <th className={styles.thJ}>Jump 1</th>
              <th className={styles.thJ}>Jump 2</th>
              <th className={styles.thJ}>Jump 3</th>
              <th className={styles.thJ}>Jump 4</th>
              <th className={styles.thJ}>Jump 5</th>
              <th className={styles.thDel}></th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => {
              const q      = questionsById[slot.questionId] ?? null;
              const jLabels = jumpLabels(q);
              const isClone = q?.question_type === '9';

              return (
                <tr key={i} className={slot.questionId ? '' : styles.emptyRow}>
                  <td className={styles.tdSeq}>{i + 1}</td>

                  <td className={styles.tdQ}>
                    <QuestionPicker
                      value={slot.questionId}
                      onChange={qId => updateSlot(i, { questionId: qId, jumps: ['0','0','0','0','0'] })}
                      allQuestions={sortedQuestions}
                      disabled={!editable}
                    />
                  </td>

                  <td className={styles.tdType}>
                    {q ? (
                      <span className={styles.typeBadge} title={TYPE_LABEL[q.question_type] ?? `Type ${q.question_type}`}>
                        {TYPE_LABEL[q.question_type] ?? `Type ${q.question_type}`}
                      </span>
                    ) : null}
                  </td>

                  <td className={styles.tdReq}>
                    <input
                      type="checkbox"
                      checked={slot.answerRequired}
                      onChange={e => updateSlot(i, { answerRequired: e.target.checked })}
                      disabled={!q || !editable}
                    />
                  </td>

                  {jLabels.map((label, ji) => (
                    <td key={ji} className={styles.tdJ}>
                      {label !== null ? (
                        <div className={styles.jumpCell}>
                          <span className={styles.jumpAnswerLabel}>{label}</span>
                          <JumpSelect
                            value={slot.jumps[ji]}
                            onChange={val => {
                              const j = [...slot.jumps]; j[ji] = val;
                              updateSlot(i, { jumps: j });
                            }}
                            slotIdx={i}
                            slots={slots}
                            routePoints={routePoints}
                            incidentsRoutePoints={incidentsRoutePoints}
                            excludeIds={excludeIds}
                            isCloneDest={isClone && ji === 0}
                            isJump1={ji === 0}
                            questionsById={questionsById}
                            disabled={!editable}
                          />
                          {/* Selected point code for CLONE JUMP — click to jump to
                              its (read-only) question set below. */}
                          {isClone && ji === 0 && isPointCode(slot.jumps[0]) && (
                            <button
                              type="button"
                              className={styles.cloneDest}
                              title="View this point's question set (read-only)"
                              onClick={() => {
                                const code = slot.jumps[0].trim();
                                followCode(code);
                                document.getElementById(`dest-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                            >
                              {slot.jumps[0].trim()}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className={styles.jumpNA}>—</span>
                      )}
                    </td>
                  ))}

                  <td className={styles.tdDel}>
                    <button
                      className={styles.delBtn}
                      onClick={() => clearSlot(i)}
                      disabled={!slot.questionId || !editable}
                      title="Clear slot"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Expanded (read-only) destination question sets ── */}
        {expanded.map(dest => (
          <ExpandedGrid
            key={dest.code}
            dest={dest}
            onFollow={followCode}
          />
        ))}
      </div>

      {showFlowChart && (
        <Modal title={`Flow Chart — ${point?.point_code?.trim()} — ${point?.description}`} onClose={() => setShowFlowChart(false)} wide>
          {!flowGraph ? (
            <div className={styles.loading}>Building diagram…</div>
          ) : currentList.length === 0 ? (
            <div className={styles.loading}>No questions on this point yet.</div>
          ) : (
            <>
              {flowGraph.truncated && (
                <div className={styles.error} style={{ marginBottom: 8 }}>
                  This checklist is large — the diagram stops at {flowGraph.nodes.length} steps.
                </div>
              )}
              <MermaidDiagram
                definition={graphToMermaid(flowGraph)}
                fileName={`Flow Chart - ${point?.point_code?.trim()} ${point?.description ?? ''}`}
              />
            </>
          )}
        </Modal>
      )}

    </div>
  );
}
