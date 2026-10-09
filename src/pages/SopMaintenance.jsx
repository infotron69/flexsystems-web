import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useScrollRestoration from '../hooks/useScrollRestoration';
import {
  getRoutePoints, addPointToRoute, removePointFromRoute,
  createPoint, updatePoint, deletePoint, sopLookup, nextSopCode,
} from '../api/client';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './SopMaintenance.module.css';

// SOPs are just Points that live under the reserved "Incidents1" pseudo-site
// and are linked to the reserved "Incidents1" pseudo-route -- same convention
// PointQuestions.jsx already uses for clone-jump destinations. This screen is
// the equivalent of the legacy app's standalone "SOP Maint" browser
// (frmIncidentsPoints): a flat directory of every SOP point in the system,
// independent of which Incident/Sub-Category row references it.
const SOP_ROUTE_ID = 'Incidents1';
const SOP_SITE_ID = 'Incidents1';

const emptyForm = { code: '', description: '' };

export default function SopMaintenance() {
  const navigate = useNavigate();
  const listBoxRef = useRef(null);
  useScrollRestoration(listBoxRef);

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');

  const [selCode, setSelCode] = useState(null);
  const [form, setForm]       = useState(emptyForm);
  const [isNew, setIsNew]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);
  const [codeEdited, setCodeEdited] = useState(false);

  const [foundIn, setFoundIn]     = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Auto-suggests a code as the description is typed for a brand-new SOP
  // (same debounced-preview pattern as Incidents.jsx's incident-code
  // suggest) -- editable, and stops auto-updating the moment the admin
  // types into the code field themselves so their edit is never clobbered.
  useEffect(() => {
    if (!isNew || codeEdited) return;
    const description = form.description.trim();
    const handle = setTimeout(() => {
      if (!description) { updateField('code', ''); return; }
      nextSopCode(description).then(code => updateField('code', code)).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [form.description, isNew, codeEdited]);

  function load() {
    setLoading(true);
    return getRoutePoints(SOP_ROUTE_ID)
      .then(rps => setRows(rps.filter(rp => rp.point)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.point.description.localeCompare(b.point.description));
    if (!filter) return sorted;
    const lc = filter.toLowerCase();
    return sorted.filter(rp =>
      rp.point.description.toLowerCase().includes(lc) ||
      rp.point.point_code.toLowerCase().includes(lc)
    );
  }, [filter, rows]);

  function selectRow(rp) {
    setSelCode(rp.point.point_code);
    setIsNew(false);
    setForm({ code: rp.point.point_code, description: rp.point.description });
    setErr(null);
    setFoundIn(null);
    setLookupLoading(true);
    sopLookup(rp.point.point_code)
      .then(r => setFoundIn(r.incident_name))
      .catch(() => setFoundIn(null))
      .finally(() => setLookupLoading(false));
  }

  function startNew() {
    setSelCode(null);
    setIsNew(true);
    setForm(emptyForm);
    setErr(null);
    setFoundIn(null);
    setCodeEdited(false);
  }

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      if (isNew) {
        const code = form.code.trim().toUpperCase();
        const description = form.description.trim().toUpperCase();
        const point = await createPoint({ point_code: code, description, site_id: SOP_SITE_ID });
        await addPointToRoute(SOP_ROUTE_ID, { route_id: SOP_ROUTE_ID, point_id: point.point_code });
        await load();
        setIsNew(false);
        setSelCode(code);
        setForm({ code, description });
      } else {
        const updated = await updatePoint(selCode, { description: form.description.trim().toUpperCase() });
        setRows(prev => prev.map(rp => rp.point.point_code === selCode ? { ...rp, point: updated } : rp));
        setForm({ code: selCode, description: updated.description });
      }
      markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selCode) return;
    const warning = foundIn
      ? `"${foundIn}" currently uses this SOP -- deleting it will leave that incident's SOP link broken. `
      : '';
    if (!confirm(`${warning}Delete SOP "${form.description}" (${selCode})? This also removes its question set.`)) return;
    try {
      await removePointFromRoute(SOP_ROUTE_ID, selCode);
      await deletePoint(selCode);
      setRows(prev => prev.filter(rp => rp.point.point_code !== selCode));
      setSelCode(null);
      setIsNew(false);
      setForm(emptyForm);
      setFoundIn(null);
      markPdaFilesDirty();
    } catch (ex) {
      alert(ex.response?.data?.detail ?? 'Delete failed');
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/setup/incidents')}>← Incidents</button>
        <h2 className={styles.heading}>SOP Maintenance</h2>
        <button className={styles.questionsBtn} style={{ marginLeft: 'auto' }} onClick={() => navigate('/setup/questions')}>
          Questions →
        </button>
        <button className={styles.questionsBtn} onClick={() => navigate('/setup/reports/sops')}>
          Print Report →
        </button>
      </div>
      <p className={styles.subheading}>
        Every Standard Operating Procedure checklist in the system, independent of which incident references it.
        Reference one from an incident's "Build SOP" setting, then edit its questions from here.
      </p>

      <div className={styles.shell}>

        {/* ── Left: SOP list ── */}
        <div className={styles.list}>
          <div className={styles.listHeader}>
            <input
              className={styles.filterInput}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter SOPs…"
            />
          </div>
          <div className={styles.listBox} ref={listBoxRef}>
            {filtered.map(rp => (
              <div
                key={rp.point.point_code}
                className={`${styles.listItem} ${selCode === rp.point.point_code ? styles.selected : ''}`}
                onClick={() => selectRow(rp)}
              >
                <span className={styles.sopDesc}>{rp.point.description}</span>
                <span className={styles.sopCode}>{rp.point.point_code}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>No SOPs</div>}
          </div>
          <button className={styles.newBtn} onClick={startNew}>+ Add SOP</button>
        </div>

        {/* ── Right: detail form ── */}
        <div className={styles.detail}>
          {(selCode != null || isNew) ? (
            <div className={styles.form}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>ID</label>
                <input
                  className={styles.formInput}
                  value={form.code}
                  onChange={e => { setCodeEdited(true); updateField('code', e.target.value.toUpperCase()); }}
                  disabled={!isNew}
                  placeholder="auto-generated from description"
                  maxLength={10}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>SOP Description</label>
                <input
                  className={styles.formInputWide}
                  value={form.description}
                  onChange={e => updateField('description', e.target.value)}
                  placeholder="e.g. *ABC EXTINGUISHER"
                  maxLength={60}
                />
              </div>

              {!isNew && (
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>First Incident Name Found</label>
                  <div className={styles.foundInBox}>
                    {lookupLoading ? '…' : (foundIn ?? <span className={styles.foundInNone}>Not currently referenced</span>)}
                  </div>
                </div>
              )}

              {err && <div className={styles.formErr}>{err}</div>}

              <div className={styles.formActions}>
                <button
                  className={styles.saveBtn}
                  onClick={save}
                  disabled={saving || !form.code.trim() || !form.description.trim()}
                >
                  {saving ? '…' : isNew ? 'Add' : 'Update'}
                </button>
                {!isNew && (
                  <>
                    <button
                      className={styles.questionsBtn}
                      onClick={() => navigate(`/setup/routes/${SOP_ROUTE_ID}/points/${selCode}/questions`)}
                    >
                      Edit Questions →
                    </button>
                    <button className={styles.deleteBtn} onClick={remove}>Delete</button>
                  </>
                )}
                {isNew && (
                  <button className={styles.cancelBtn} onClick={() => setIsNew(false)}>Cancel</button>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.noSelection}>
              Select a SOP from the list, or click <strong>+ Add SOP</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
