import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  getRoute, getRoutePoints, getAllQuestions,
  getRoutePointQuestions, getRoutePointQuestionCounts, replaceRoutePointQuestions,
} from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import useGoBack from '../hooks/useGoBack';
import { markPdaFilesDirty } from '../pdaDirty';
import {
  MAX_SLOTS, TYPE_LABEL, jumpLabels, mkEmpty, rpqToSlot,
  JumpSelect, QuestionPicker,
} from './pointQuestionsShared';
import styles from './PointQuestions.module.css';

// Legacy "Multi-Point Question Assignment" (frmRoutesPoints.frm +
// frmRoutesPointsQuestions.frm): build ONE question list, then apply it to
// every selected point on the route with a delete-all-then-insert-all,
// same as the single-point PointQuestions.jsx Save, just fanned out.
export default function BulkPointQuestions() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { canEdit } = useCanEditSite();

  const pointIds = location.state?.pointIds ?? [];

  const [route,        setRoute]        = useState(null);
  const goBack = useGoBack(route?.site_id ? `/setup/sites/${route.site_id}/routes` : '/setup/customers');
  const [routePoints,  setRoutePoints]  = useState([]);
  const [incidentsRoutePoints, setIncidentsRoutePoints] = useState([]);
  const [allQuestions, setAllQuestions] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  const [slots,   setSlots]   = useState(() => Array.from({ length: MAX_SLOTS }, mkEmpty));
  const [saving,  setSaving]  = useState(false);
  const [preloading, setPreloading] = useState(false);
  // point_id -> question count on this route -- only points with a checklist
  // already built are worth offering as a "start from" source.
  const [questionCounts, setQuestionCounts] = useState({});

  useEffect(() => {
    if (pointIds.length === 0) { setLoading(false); return; }
    Promise.all([
      getRoute(routeId),
      getRoutePoints(routeId),
      getAllQuestions(),
      routeId === 'Incidents1' ? Promise.resolve([]) : getRoutePoints('Incidents1').catch(() => []),
      getRoutePointQuestionCounts(routeId).catch(() => ({})),
    ])
      .then(([r, rp, aq, incRp, counts]) => {
        setRoute(r);
        setRoutePoints(rp);
        setAllQuestions(aq);
        setIncidentsRoutePoints(incRp);
        setQuestionCounts(counts);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [routeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const questionsById = useMemo(() => {
    const m = {};
    allQuestions.forEach(q => { m[q.id] = q; });
    return m;
  }, [allQuestions]);

  const selectedPoints = useMemo(
    () => routePoints.filter(rp => pointIds.includes(rp.point_id)),
    [routePoints, pointIds]
  );

  // Jump targets can't point back at any of the points being edited here.
  const excludeIds = useMemo(() => new Set(pointIds), [pointIds]);

  async function preloadFrom(sourcePointId) {
    if (!sourcePointId) return;
    setPreloading(true);
    try {
      const qs = await getRoutePointQuestions(routeId, sourcePointId);
      const loaded = qs.map(rpqToSlot);
      while (loaded.length < MAX_SLOTS) loaded.push(mkEmpty());
      setSlots(loaded);
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
  }

  function clearSlot(i) {
    setSlots(prev => {
      const n = [...prev];
      n[i] = mkEmpty();
      return n;
    });
  }

  async function applyToAll() {
    setSaving(true);
    setError(null);
    try {
      const payload = slots
        .filter(s => s.questionId != null)
        .map((s, i) => ({
          question_id:     s.questionId,
          seqno:           i + 1,
          answer_required: s.answerRequired ? 'Y' : 'N',
          jump1: s.jumps[0] || null,
          jump2: s.jumps[1] || null,
          jump3: s.jumps[2] || null,
          jump4: s.jumps[3] || null,
          jump5: s.jumps[4] || null,
        }));
      const results = await Promise.allSettled(
        pointIds.map(pid => replaceRoutePointQuestions(routeId, pid, payload))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed < pointIds.length) markPdaFilesDirty();
      if (failed > 0) {
        setError(`Applied to ${pointIds.length - failed} of ${pointIds.length} points — ${failed} failed. Fix and try again, or go back and re-check which points still need it.`);
      } else {
        navigate(`/setup/sites/${route.site_id}/routes`, { state: { routeId } });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  if (pointIds.length === 0) {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} style={{ marginBottom: 12 }} onClick={goBack}>← Back</button>
        <div className={styles.error}>
          No points were selected. Go back to Routes, select multiple points in "Points Allocated for Route"
          (shift/ctrl+click), then click "Assign Questions to N Points →".
        </div>
      </div>
    );
  }

  const editable = canEdit(route?.site_id, 'questions');
  const filledCount = slots.filter(s => s.questionId != null).length;

  return (
    <div className={styles.page}>

      {/* ── Header bar ── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={goBack}>← Back</button>
        <div className={styles.titleBlock}>
          <span className={styles.routeLabel}>{route?.name}</span>
          <span className={styles.arrow}>›</span>
          <span className={styles.pointLabel}>Assign Questions — {pointIds.length} points</span>
        </div>
        <div className={styles.headerActions}>
          {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
          <span className={styles.slotCount}>{filledCount} / {MAX_SLOTS}</span>
          {editable && (
            <button className={styles.saveBtn} onClick={applyToAll} disabled={saving}>
              {saving ? 'Applying…' : `Apply to ${pointIds.length} Points`}
            </button>
          )}
        </div>
      </div>

      {/* ── Which points this will overwrite ── */}
      <div className={styles.bulkTargetsBar}>
        <span className={styles.preloadLabel}>This will replace the entire question list on:</span>
        <div className={styles.bulkChips}>
          {selectedPoints.map(rp => (
            <span key={rp.point_id} className={styles.bulkChip}>
              {rp.point?.point_code?.trim() ?? rp.point_id}
            </span>
          ))}
        </div>
      </div>

      {/* ── Optional: start from an existing point's questions ── */}
      {editable && (
        <div className={styles.preloadBar}>
          <label className={styles.preloadLabel}>Start from an existing point's questions:</label>
          <select
            className={styles.preloadSelect}
            value=""
            disabled={preloading}
            onChange={e => preloadFrom(e.target.value)}
          >
            <option value="">{preloading ? 'Loading…' : '— select a point —'}</option>
            {routePoints
              .filter(rp => rp.point?.point_code && questionCounts[rp.point_id] > 0)
              .sort((a, b) => a.point.point_code.localeCompare(b.point.point_code))
              .map(rp => (
                <option key={rp.point_id} value={rp.point_id}>
                  {rp.point.point_code.trim()} – {rp.point.description}
                </option>
              ))}
          </select>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Flat question grid — one shared list, applied to every point above ── */}
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

              return (
                <tr key={i} className={slot.questionId ? '' : styles.emptyRow}>
                  <td className={styles.tdSeq}>{i + 1}</td>

                  <td className={styles.tdQ}>
                    <QuestionPicker
                      value={slot.questionId}
                      onChange={qId => updateSlot(i, { questionId: qId, jumps: ['0','0','0','0','0'] })}
                      allQuestions={allQuestions}
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
                            isCloneDest={q?.question_type === '9' && ji === 0}
                            isJump1={ji === 0}
                            questionsById={questionsById}
                            disabled={!editable}
                          />
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
      </div>

    </div>
  );
}
