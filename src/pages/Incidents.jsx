import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getIncidents,       createIncident,      updateIncident,      deleteIncident,
  getIncidentSub1,    createIncidentSub1,  updateIncidentSub1,  deleteIncidentSub1,
  getIncidentSub2,    createIncidentSub2,  updateIncidentSub2,  deleteIncidentSub2,
  getIncidentSub3,    createIncidentSub3,  updateIncidentSub3,  deleteIncidentSub3,
  getRoutePoints, createPoint, addPointToRoute,
  nextIncidentCode,
} from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './Incidents.module.css';

// The special "Incidents1" route/site holds the SOP point sequences that
// Incident/SubCat "Build SOP" jump points reference — same convention as
// the legacy VB6 app's clone-jump destinations.
const SOP_ROUTE_ID = 'Incidents1';

function sortByName(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline add form — appears at the top of a listbox column
// ─────────────────────────────────────────────────────────────────────────────
function InlineAddForm({ onSave, onCancel, level }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Auto-suggests the next code as the name is typed (same legacy-format
  // logic as before), but now shown in an editable field instead of being
  // generated silently at submit time -- the admin can override it before
  // saving. Stops auto-updating the moment they've typed into the code
  // field themselves, so their edit is never clobbered by a later suggestion.
  useEffect(() => {
    if (codeEdited) return;
    if (!name.trim()) { setCode(''); return; }
    const handle = setTimeout(() => {
      nextIncidentCode(level, name.trim()).then(setCode).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [name, level, codeEdited]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const finalCode = code.trim() || await nextIncidentCode(level, name.trim());
      await onSave({ code: finalCode, name: name.trim().toUpperCase() });
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <form className={styles.inlineForm} onSubmit={handleSubmit}>
      <div className={styles.inlineFormRow}>
        <input
          className={styles.inlineInput}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          maxLength={30}
          required
          autoFocus
        />
      </div>
      <div className={styles.inlineFormRow}>
        <input
          className={styles.inlineInput}
          value={code}
          onChange={e => { setCode(e.target.value); setCodeEdited(true); }}
          placeholder="Code (auto-generated)"
          maxLength={10}
        />
      </div>
      {err && <div className={styles.inlineFormErr}>{err}</div>}
      <div className={styles.inlineFormRow}>
        <button type="submit" className={styles.inlineSaveBtn} disabled={saving}>
          {saving ? '…' : 'Add'}
        </button>
        <button type="button" className={styles.inlineCancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One listbox column panel
// ─────────────────────────────────────────────────────────────────────────────
function IncidentPanel({
  label,
  parentName,    // name of selected parent (shown under the label)
  items,         // the list of items to display
  selectedItem,
  onSelect,
  onAdd,         // (body) => Promise — null when column is disabled
  disabled,
  editable,      // false = view-only, hide the <Add> pseudo-item
  level,         // "0"-"3", passed through to InlineAddForm for code generation
}) {
  const [adding, setAdding] = useState(false);

  // Reset add-form when parent changes
  useEffect(() => { setAdding(false); }, [parentName]);

  async function handleAdd(body) {
    await onAdd(body);
    setAdding(false);
  }

  return (
    <div className={`${styles.panel} ${disabled ? styles.panelDisabled : ''}`}>
      <div className={styles.panelHeader}>
        <span className={styles.panelLabel}>{label}</span>
        {parentName && <span className={styles.panelParent}>{parentName}</span>}
      </div>

      <div className={styles.listBox}>
        {/* <Add> pseudo-item */}
        {!disabled && !adding && editable && (
          <div className={styles.addItem} onClick={() => setAdding(true)}>
            &lt;Add&gt;
          </div>
        )}

        {/* Inline add form */}
        {adding && (
          <InlineAddForm
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
            level={level}
          />
        )}

        {/* Items */}
        {items.map(item => (
          <div
            key={item.id}
            className={`${styles.listItem} ${selectedItem?.id === item.id ? styles.selected : ''}`}
            onClick={() => onSelect(item)}
          >
            {item.name}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bottom detail cell — shows selected item for editing
// ─────────────────────────────────────────────────────────────────────────────
function DetailCell({ label, item, onUpdate, onDelete, sopOptions, onSopCreated, editable }) {
  const navigate = useNavigate();
  const [name,     setName]     = useState(item?.name             ?? '');
  const [code,     setCode]     = useState(item?.code             ?? '');
  const [hasSop,   setHasSop]   = useState(item?.has_sop_questions === 'Y');
  const [sopPoint, setSopPoint] = useState(item?.sop_jump_point   ?? '');
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Sync fields when selected item changes
  useEffect(() => {
    setName(item?.name ?? '');
    setCode(item?.code ?? '');
    setHasSop(item?.has_sop_questions === 'Y');
    setSopPoint(item?.sop_jump_point ?? '');
    setConfirmDel(false);
  }, [item?.id]);

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      await onUpdate(item.id, {
        code:               code.trim().toUpperCase(),
        name:               name.trim().toUpperCase(),
        has_sop_questions:  hasSop ? 'Y' : 'N',
        sop_jump_point:     sopPoint.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfigureSop() {
    const trimmed = sopPoint.trim();
    if (!trimmed) {
      alert('Enter a SOP jump point code first, then Save.');
      return;
    }
    await handleSave();
    navigate(`/setup/routes/${SOP_ROUTE_ID}/points/${trimmed}/questions`);
  }

  // The "SOP jump point" dropdown only ever listed SOPs that already exist
  // in SOP Maintenance -- there was no way to create a brand-new one from
  // here, so attaching a never-before-seen SOP to an incident was a dead
  // end (the dropdown had nothing to select, and the only feedback was
  // handleConfigureSop's "enter a code first" alert with no field to type
  // one into). This creates the SOP point the same way SopMaintenance.jsx
  // does, then selects it immediately.
  async function handleCreateNewSop() {
    const newCode = window.prompt('Code for the new SOP (e.g. C000000200):');
    if (!newCode || !newCode.trim()) return;
    const trimmedCode = newCode.trim().toUpperCase();
    const description = window.prompt('Description for this SOP:', name.trim() || '');
    if (description === null) return;
    try {
      await createPoint({ point_code: trimmedCode, description: description.trim().toUpperCase(), site_id: SOP_ROUTE_ID });
      await addPointToRoute(SOP_ROUTE_ID, { route_id: SOP_ROUTE_ID, point_id: trimmedCode });
      setSopPoint(trimmedCode);
      setHasSop(true);
      onSopCreated?.();
      markPdaFilesDirty();
    } catch (ex) {
      alert('Could not create SOP: ' + (ex.response?.data?.detail ?? ex.message));
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return; }
    setDeleting(true);
    try {
      await onDelete(item.id);
    } catch (e) {
      alert('Delete failed: ' + (e.response?.data?.detail ?? e.message));
      setDeleting(false);
      setConfirmDel(false);
    }
  }

  const noItem = !item;

  return (
    <div className={styles.detailCell}>
      <div className={styles.detailLabel}>
        {label}{item ? ` — ${hasSop ? '(SOP)' : '(Normal)'}` : ''}
      </div>

      <input
        className={styles.detailInput}
        value={name}
        onChange={e => { setName(e.target.value); setConfirmDel(false); }}
        placeholder="Name"
        maxLength={30}
        disabled={noItem || !editable}
      />

      <select
        className={styles.detailInput}
        value={sopPoint}
        onChange={e => {
          if (e.target.value === '__create_new__') { handleCreateNewSop(); return; }
          setSopPoint(e.target.value);
          setConfirmDel(false);
        }}
        disabled={noItem || !editable}
        style={{ fontSize: '0.78rem' }}
      >
        <option value="">— SOP jump point —</option>
        <option value="__create_new__">+ Create New SOP…</option>
        {sopPoint && !sopOptions.some(rp => rp.point.point_code === sopPoint) && (
          <option value={sopPoint}>{sopPoint} (not in SOP Maintenance)</option>
        )}
        {sopOptions.map(rp => (
          <option key={rp.point.point_code} value={rp.point.point_code}>
            {rp.point.point_code} – {rp.point.description}
          </option>
        ))}
      </select>

      <label className={styles.detailCheck}>
        <input
          type="checkbox"
          checked={hasSop}
          onChange={e => { setHasSop(e.target.checked); setConfirmDel(false); }}
          disabled={noItem || !editable}
        />
        Build SOP Y/N?
      </label>

      {!noItem && hasSop && editable && (
        <button className={styles.sopConfigBtn} onClick={handleConfigureSop}>
          Configure SOP Questions →
        </button>
      )}

      {!noItem && editable && (
        <div className={styles.detailActions}>
          <button
            className={styles.detailSaveBtn}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '…' : 'Save'}
          </button>
          {confirmDel ? (
            <>
              <button
                className={styles.detailDeleteBtn}
                onClick={handleDelete}
                disabled={deleting}
                style={{ background: '#b91c1c', color: '#fff' }}
              >
                {deleting ? '…' : 'Confirm ×'}
              </button>
              <button
                className={styles.inlineCancelBtn}
                onClick={() => setConfirmDel(false)}
              >
                ✕
              </button>
            </>
          ) : (
            <button className={styles.detailDeleteBtn} onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function Incidents() {
  const navigate = useNavigate();
  const { hasAnyEditAccess: editable } = useCanEditSite();
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Each level: the full item list + the currently-selected item
  const [masters,  setMasters]  = useState([]);
  const [selMaster, setSelMaster] = useState(null);

  const [sub1,     setSub1]     = useState([]);
  const [selSub1,  setSelSub1]  = useState(null);

  const [sub2,     setSub2]     = useState([]);
  const [selSub2,  setSelSub2]  = useState(null);

  const [sub3,     setSub3]     = useState([]);
  const [selSub3,  setSelSub3]  = useState(null);

  // SOPs available to attach as a "Build SOP" jump point, for the picker in
  // each DetailCell -- fetched once and shared across all 4 columns.
  const [sopOptions, setSopOptions] = useState([]);

  function loadSopOptions() {
    // A hidden SOP stays wired wherever it's already selected (the picker
    // below falls back to showing the current selection even when it isn't
    // in this list) -- hiding only stops it from being offered as a NEW pick.
    return getRoutePoints(SOP_ROUTE_ID)
      .then(rps => setSopOptions(rps.filter(rp => rp.point && rp.point.is_hidden !== 'Y')))
      .catch(() => setSopOptions([]));
  }

  // ── Load masters on mount ──────────────────────────────────────────────────
  useEffect(() => {
    getIncidents()
      .then(list => setMasters(sortByName(list)))
      .catch(() => setError('Failed to load incident types'))
      .finally(() => setLoading(false));
    loadSopOptions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load sub1 when master changes ─────────────────────────────────────────
  useEffect(() => {
    setSub1([]);  setSelSub1(null);
    setSub2([]);  setSelSub2(null);
    setSub3([]);  setSelSub3(null);
    if (!selMaster) return;
    getIncidentSub1(selMaster.id).then(list => setSub1(sortByName(list))).catch(() => setSub1([]));
  }, [selMaster?.id]);

  // ── Load sub2 when sub1 changes ───────────────────────────────────────────
  useEffect(() => {
    setSub2([]);  setSelSub2(null);
    setSub3([]);  setSelSub3(null);
    if (!selSub1) return;
    getIncidentSub2(selSub1.id).then(list => setSub2(sortByName(list))).catch(() => setSub2([]));
  }, [selSub1?.id]);

  // ── Load sub3 when sub2 changes ───────────────────────────────────────────
  useEffect(() => {
    setSub3([]);  setSelSub3(null);
    if (!selSub2) return;
    getIncidentSub3(selSub2.id).then(list => setSub3(sortByName(list))).catch(() => setSub3([]));
  }, [selSub2?.id]);

  // ── Add handlers ──────────────────────────────────────────────────────────
  async function addMaster(body) {
    const created = await createIncident(body);
    setMasters(prev => sortByName([...prev, created]));
    markPdaFilesDirty();
  }

  async function addSub1(body) {
    const created = await createIncidentSub1({ ...body, master_id: selMaster.id });
    setSub1(prev => sortByName([...prev, created]));
    markPdaFilesDirty();
  }

  async function addSub2(body) {
    const created = await createIncidentSub2({ ...body, parent_id: selSub1.id });
    setSub2(prev => sortByName([...prev, created]));
    markPdaFilesDirty();
  }

  async function addSub3(body) {
    const created = await createIncidentSub3({ ...body, parent_id: selSub2.id });
    setSub3(prev => sortByName([...prev, created]));
    markPdaFilesDirty();
  }

  // ── Update handlers (also refresh the selected item in state) ─────────────
  async function handleUpdateMaster(id, body) {
    const updated = await updateIncident(id, body);
    setMasters(prev => prev.map(m => m.id === id ? updated : m));
    setSelMaster(updated);
    markPdaFilesDirty();
  }

  async function handleUpdateSub1(id, body) {
    const updated = await updateIncidentSub1(id, body);
    setSub1(prev => prev.map(s => s.id === id ? updated : s));
    setSelSub1(updated);
    markPdaFilesDirty();
  }

  async function handleUpdateSub2(id, body) {
    const updated = await updateIncidentSub2(id, body);
    setSub2(prev => prev.map(s => s.id === id ? updated : s));
    setSelSub2(updated);
    markPdaFilesDirty();
  }

  async function handleUpdateSub3(id, body) {
    const updated = await updateIncidentSub3(id, body);
    setSub3(prev => prev.map(s => s.id === id ? updated : s));
    setSelSub3(updated);
    markPdaFilesDirty();
  }

  // ── Delete handlers ───────────────────────────────────────────────────────
  async function handleDeleteMaster(id) {
    await deleteIncident(id);
    setMasters(prev => prev.filter(m => m.id !== id));
    setSelMaster(null);
    markPdaFilesDirty();
  }

  async function handleDeleteSub1(id) {
    await deleteIncidentSub1(id);
    setSub1(prev => prev.filter(s => s.id !== id));
    setSelSub1(null);
    markPdaFilesDirty();
  }

  async function handleDeleteSub2(id) {
    await deleteIncidentSub2(id);
    setSub2(prev => prev.filter(s => s.id !== id));
    setSelSub2(null);
    markPdaFilesDirty();
  }

  async function handleDeleteSub3(id) {
    await deleteIncidentSub3(id);
    setSub3(prev => prev.filter(s => s.id !== id));
    setSelSub3(null);
    markPdaFilesDirty();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          Incidents
          {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
        </h2>
        <button className={styles.sopMaintBtn} onClick={() => navigate('/setup/sops')}>SOP Maint →</button>
        <button className={styles.questionsBtn} onClick={() => navigate('/setup/questions')}>Questions →</button>
        <button className={styles.questionsBtn} onClick={() => navigate('/setup/reports/incidents')}>Print Report →</button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── 4 listbox columns ── */}
      <div className={styles.columns}>
        <IncidentPanel
          label="Incident:"
          items={masters}
          selectedItem={selMaster}
          onSelect={setSelMaster}
          onAdd={addMaster}
          editable={editable}
          level="0"
        />

        <IncidentPanel
          label="Sub Category 1:"
          parentName={selMaster?.name}
          items={sub1}
          selectedItem={selSub1}
          onSelect={setSelSub1}
          onAdd={addSub1}
          disabled={!selMaster}
          editable={editable}
          level="1"
        />

        <IncidentPanel
          label="Sub Category 2:"
          parentName={selSub1?.name}
          items={sub2}
          selectedItem={selSub2}
          onSelect={setSelSub2}
          onAdd={addSub2}
          disabled={!selSub1}
          editable={editable}
          level="2"
        />

        <IncidentPanel
          label="Sub Category 3:"
          parentName={selSub2?.name}
          items={sub3}
          selectedItem={selSub3}
          onSelect={setSelSub3}
          onAdd={addSub3}
          disabled={!selSub2}
          editable={editable}
          level="3"
        />
      </div>

      {/* ── Bottom detail strip (one cell per column) ── */}
      <div className={styles.detailStrip}>
        <DetailCell
          label="Incident"
          item={selMaster}
          onUpdate={handleUpdateMaster}
          onDelete={handleDeleteMaster}
          sopOptions={sopOptions}
          onSopCreated={loadSopOptions}
          editable={editable}
        />
        <DetailCell
          label="Incident 1"
          item={selSub1}
          onUpdate={handleUpdateSub1}
          onDelete={handleDeleteSub1}
          sopOptions={sopOptions}
          onSopCreated={loadSopOptions}
          editable={editable}
        />
        <DetailCell
          label="Incident 2"
          item={selSub2}
          onUpdate={handleUpdateSub2}
          onDelete={handleDeleteSub2}
          sopOptions={sopOptions}
          onSopCreated={loadSopOptions}
          editable={editable}
        />
        <DetailCell
          label="Incident 3"
          item={selSub3}
          onUpdate={handleUpdateSub3}
          onDelete={handleDeleteSub3}
          sopOptions={sopOptions}
          onSopCreated={loadSopOptions}
          editable={editable}
        />
      </div>
    </div>
  );
}
