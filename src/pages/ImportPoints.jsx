import { useEffect, useState, useMemo, useRef } from 'react';
import useScrollRestoration from '../hooks/useScrollRestoration';
import {
  getCustomers, getSites, getRoutes, getRoutePoints, getRoutePointQuestionCounts,
  importPoints, getPoints, getPoint, createPoint, updatePoint, nextPointCode,
  deletePoint, getPointUsage,
} from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './Questions.module.css';

const emptyEditForm = {
  pointCode: '',
  description: '', location: '', category: '', subCategory: '',
  notes1: '', notes2: '', notes3: '', notes4: '', notes5: '',
};

// Marker used in place of a real point_code while editingCode holds the
// "add a new point" form -- distinguishes it from editing an existing point
// (whose code is a real, already-created Point_ID) without a separate set
// of add/edit state and JSX to keep in sync.
const NEW_POINT = '__new__';

export default function ImportPoints() {
  const { canEdit } = useCanEditSite();
  const listBoxRef = useRef(null);
  useScrollRestoration(listBoxRef);

  const [customers, setCustomers] = useState([]);
  const [sites, setSites]         = useState([]);
  const [loading, setLoading]     = useState(true);

  const [siteId, setSiteId]   = useState('');
  const [routes, setRoutes]   = useState([]);
  const [routeId, setRouteId] = useState('');

  const [routePoints, setRoutePoints]       = useState([]);
  const [questionCounts, setQuestionCounts] = useState({});
  const [preloadFrom, setPreloadFrom]       = useState('');

  // Points belong to a site, not a route -- editable independently of
  // which route (if any) is selected for import/preload.
  const [sitePoints, setSitePoints] = useState([]);

  const [file, setFile]       = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult]   = useState(null);
  const [err, setErr]         = useState(null);

  const [editingCode, setEditingCode] = useState(null); // point_id being edited
  const [editForm, setEditForm]       = useState(emptyEditForm);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving]   = useState(false);
  const [editErr, setEditErr]         = useState(null);

  // Delete confirmation for the point being edited: { loading } while its
  // usage is fetched, then { usage } (what deleting would remove) or { error }.
  const [delInfo, setDelInfo]   = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([getCustomers(), getSites()])
      .then(([c, s]) => { setCustomers(c); setSites(s); })
      .finally(() => setLoading(false));
  }, []);

  const editable = siteId ? canEdit(siteId, 'routes') : true;

  function selectSite(id) {
    setSiteId(id);
    setRouteId('');
    setRoutes([]);
    setRoutePoints([]);
    setQuestionCounts({});
    setSitePoints([]);
    setPointSearch('');
    setPreloadFrom('');
    setResult(null);
    setErr(null);
    cancelEditPoint();
    if (!id) return;
    getRoutes({ site_id: id }).then(setRoutes);
    getPoints({ site_id: id }).then(setSitePoints);
  }

  function selectRoute(id) {
    setRouteId(id);
    setPreloadFrom('');
    setRoutePoints([]);
    setQuestionCounts({});
    setResult(null);
    setErr(null);
    if (!id) return;
    Promise.all([getRoutePoints(id), getRoutePointQuestionCounts(id)]).then(([rps, counts]) => {
      setRoutePoints(rps);
      setQuestionCounts(counts);
    });
  }

  function startDelete() {
    setDelInfo({ loading: true });
    getPointUsage(editingCode)
      .then(usage => setDelInfo({ usage }))
      .catch(() => setDelInfo({ error: 'Could not check where this point is used.' }));
  }

  async function confirmDelete() {
    const code = editingCode;
    setDeleting(true);
    try {
      await deletePoint(code);
      setSitePoints(prev => prev.filter(p => p.id !== code));
      setRoutePoints(prev => prev.filter(rp => rp.point_id !== code));
      cancelEditPoint();
      markPdaFilesDirty();
    } catch (ex) {
      setDelInfo({ error: ex.response?.data?.detail ?? 'Delete failed' });
    } finally {
      setDeleting(false);
    }
  }

  function startEditPoint(pointId) {
    setDelInfo(null);
    setEditingCode(pointId);
    setEditForm(emptyEditForm);
    setEditErr(null);
    setEditLoading(true);
    getPoint(pointId)
      .then(p => setEditForm({
        pointCode:   p.point_code ?? '',
        description: p.description ?? '',
        location:    p.location ?? '',
        category:    p.category ?? '',
        subCategory: p.sub_category ?? '',
        notes1:      p.notes1 ?? '',
        notes2:      p.notes2 ?? '',
        notes3:      p.notes3 ?? '',
        notes4:      p.notes4 ?? '',
        notes5:      p.notes5 ?? '',
      }))
      .catch(() => setEditErr('Failed to load point'))
      .finally(() => setEditLoading(false));
  }

  function startAddPoint() {
    setEditingCode(NEW_POINT);
    setEditForm(emptyEditForm);
    setEditErr(null);
    setEditLoading(false);
    // Point codes are a site-scoped numeric sequence, not derived from the
    // description (unlike SOP codes) -- one fetch on open is enough, no
    // need to re-run this as the admin types. Still editable afterward if
    // they want to override it.
    nextPointCode(siteId)
      .then(code => setEditForm(prev => ({ ...prev, pointCode: code })))
      .catch(() => {});
  }

  function cancelEditPoint() {
    setDelInfo(null);
    setEditingCode(null);
    setEditForm(emptyEditForm);
    setEditErr(null);
  }

  function updateEditField(key, value) {
    setEditForm(prev => ({ ...prev, [key]: value }));
  }

  async function saveEditPoint() {
    setEditSaving(true);
    setEditErr(null);
    const isNew = editingCode === NEW_POINT;
    // New point IDs are always 10 characters -- an all-digit code gets its
    // leading zeros back (the server does the same for imports and renames).
    const typed = editForm.pointCode.trim().toUpperCase();
    const newCode = isNew && /^\d+$/.test(typed) && typed.length < 10 ? typed.padStart(10, '0') : typed;
    const isRename = !isNew && newCode !== editingCode;
    try {
      const body = {
        description: editForm.description.trim().toUpperCase(),
        location:    editForm.location.trim().toUpperCase() || null,
        category:     editForm.category.trim().toUpperCase() || null,
        sub_category: editForm.subCategory.trim().toUpperCase() || null,
        notes1:      editForm.notes1.trim().toUpperCase() || null,
        notes2:      editForm.notes2.trim().toUpperCase() || null,
        notes3:      editForm.notes3.trim().toUpperCase() || null,
        notes4:      editForm.notes4.trim().toUpperCase() || null,
        notes5:      editForm.notes5.trim().toUpperCase() || null,
      };
      const saved = isNew
        ? await createPoint({ ...body, point_code: newCode, site_id: siteId })
        : await updatePoint(editingCode, isRename ? { ...body, point_code: newCode } : body);
      setSitePoints(prev => isNew ? [...prev, saved] : prev.map(p => p.id === editingCode ? saved : p));
      // The point's fields (and code, on a rename) may also be embedded in
      // the route lists currently on screen (preload options, allocated-
      // points panel).
      setRoutePoints(prev => prev.map(rp => rp.point_id === editingCode
        ? { ...rp, point_id: saved.id, point: { ...rp.point, ...saved } }
        : rp));
      cancelEditPoint();
      markPdaFilesDirty();
    } catch (ex) {
      setEditErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }

  const preloadOptions = useMemo(
    () => routePoints
      .filter(rp => rp.point?.point_code && questionCounts[rp.point_id] > 0)
      .sort((a, b) => a.point.point_code.localeCompare(b.point.point_code)),
    [routePoints, questionCounts]
  );

  const [pointSearch, setPointSearch] = useState('');

  // Matches against everything shown or editable on a point, so a code, part
  // of a description, a location or a PDA note all find it.
  const sortedSitePoints = useMemo(() => {
    const q = pointSearch.trim().toLowerCase();
    const matches = !q ? sitePoints : sitePoints.filter(p =>
      [p.point_code, p.description, p.location, p.category, p.sub_category,
        p.notes1, p.notes2, p.notes3, p.notes4, p.notes5]
        .some(v => (v ?? '').toLowerCase().includes(q))
    );
    return [...matches].sort((a, b) => a.point_code.localeCompare(b.point_code));
  }, [sitePoints, pointSearch]);

  async function submit() {
    setImporting(true);
    setErr(null);
    setResult(null);
    try {
      const res = await importPoints(file, siteId, routeId, preloadFrom || null);
      setResult(res);
      setFile(null);
      if (res.created > 0 || res.linked > 0) markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Edit / Import Points</h2>
      </div>

      <div className={styles.form} style={{ maxWidth: 520 }}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Select Site</label>
          <select className={styles.formInputWide} value={siteId} onChange={e => selectSite(e.target.value)}>
            <option value="">— select a site —</option>
            {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
              <optgroup key={c.id} label={c.name}>
                {sites.filter(s => s.customer_id === c.id).sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Select Route</label>
          <select
            className={styles.formInputWide}
            value={routeId}
            onChange={e => selectRoute(e.target.value)}
            disabled={!siteId}
          >
            <option value="">— select a route —</option>
            {[...routes]
              .sort((a, b) => (a.display_name || a.name).localeCompare(b.display_name || b.name))
              .map(r => <option key={r.id} value={r.id}>{r.display_name || r.name}</option>)}
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Preload questions from another point on this route (optional)</label>
          <select
            className={styles.formInputWide}
            value={preloadFrom}
            onChange={e => setPreloadFrom(e.target.value)}
            disabled={!routeId}
          >
            <option value="">— none —</option>
            {preloadOptions.map(rp => (
              <option key={rp.point_id} value={rp.point_id}>
                {rp.point.point_code} — {rp.point.description} ({questionCounts[rp.point_id]} question{questionCounts[rp.point_id] === 1 ? '' : 's'})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Spreadsheet (.xlsx)</label>
          <input
            type="file"
            accept=".xlsx"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {!editable && <div className={styles.formErr}>View-only access to this site — import is disabled.</div>}
        {err && <div className={styles.formErr}>{err}</div>}

        <div className={styles.formActions}>
          <button
            className={styles.saveBtn}
            onClick={submit}
            disabled={importing || !editable || !siteId || !routeId || !file}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>

      {siteId && (
        <div style={{ marginTop: 24, maxWidth: 700 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Edit Points</h3>
            {editable && (
              <button className={styles.newBtn} onClick={startAddPoint} disabled={editingCode === NEW_POINT}>
                + Add Point
              </button>
            )}
          </div>
          {sitePoints.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input
                className={styles.formInput}
                style={{ flex: '0 1 320px' }}
                type="search"
                value={pointSearch}
                placeholder="Search points by code, description, location…"
                onChange={e => setPointSearch(e.target.value)}
              />
              {pointSearch && (
                <button className={styles.cancelBtn} onClick={() => setPointSearch('')}>Clear</button>
              )}
              <span className={styles.formHint}>
                {pointSearch.trim() ? `${sortedSitePoints.length} of ${sitePoints.length} points` : `${sitePoints.length} points`}
              </span>
            </div>
          )}
          {sitePoints.length === 0 && editingCode !== NEW_POINT ? (
            <div className={styles.empty}>No points for this site yet.</div>
          ) : sortedSitePoints.length === 0 && editingCode !== NEW_POINT ? (
            <div className={styles.empty}>No points match "{pointSearch.trim()}".</div>
          ) : (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div className={styles.listBox} ref={listBoxRef} style={{ maxHeight: 320, overflowY: 'auto', minWidth: 280, flex: '1 1 280px' }}>
                {sortedSitePoints.map(p => (
                  <div
                    key={p.id}
                    className={`${styles.listItem} ${editingCode === p.id ? styles.selected : ''}`}
                    onClick={() => startEditPoint(p.id)}
                  >
                    <span className={styles.qDesc}>{p.point_code}</span>
                    <span className={styles.qCat}>{p.description}</span>
                  </div>
                ))}
              </div>

              {editingCode && (
                <div className={styles.form} style={{ flex: '1 1 320px', maxWidth: 360 }}>
                  {editLoading ? <div className={styles.loading}>Loading…</div> : (
                    <>
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Point Code</label>
                        <input
                          className={styles.formInput}
                          value={editForm.pointCode}
                          disabled={!editable}
                          maxLength={10}
                          placeholder="auto-generated"
                          onChange={e => updateEditField('pointCode', e.target.value.toUpperCase())}
                        />
                        {editingCode !== NEW_POINT && (
                          <span className={styles.formHint}>
                            Renaming updates this point's routes, questions and SOP jump targets.
                            Historical transaction records keep the old code.
                          </span>
                        )}
                      </div>
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Description</label>
                        <input
                          className={styles.formInputWide}
                          value={editForm.description}
                          disabled={!editable}
                          maxLength={60}
                          onChange={e => updateEditField('description', e.target.value)}
                        />
                      </div>
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Location</label>
                        <input
                          className={styles.formInput}
                          value={editForm.location}
                          disabled={!editable}
                          onChange={e => updateEditField('location', e.target.value)}
                        />
                      </div>
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Category</label>
                        <input
                          className={styles.formInput}
                          value={editForm.category}
                          disabled={!editable}
                          maxLength={50}
                          onChange={e => updateEditField('category', e.target.value)}
                        />
                      </div>
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Sub-Category</label>
                        <input
                          className={styles.formInput}
                          value={editForm.subCategory}
                          disabled={!editable}
                          maxLength={50}
                          onChange={e => updateEditField('subCategory', e.target.value)}
                        />
                      </div>
                      {[1, 2, 3, 4, 5].map(i => (
                        <div className={styles.formRow} key={i}>
                          <label className={styles.formLabel}>PDA Note {i}</label>
                          <input
                            className={styles.formInput}
                            value={editForm[`notes${i}`]}
                            disabled={!editable}
                            maxLength={24}
                            onChange={e => updateEditField(`notes${i}`, e.target.value)}
                          />
                        </div>
                      ))}

                      {editErr && <div className={styles.formErr}>{editErr}</div>}

                      <div className={styles.formActions}>
                        {editable && (
                          <button
                            className={styles.saveBtn}
                            onClick={saveEditPoint}
                            disabled={editSaving || !editForm.description.trim() || (editingCode === NEW_POINT && !editForm.pointCode.trim())}
                          >
                            {editSaving ? '…' : editingCode === NEW_POINT ? 'Add' : 'Save'}
                          </button>
                        )}
                        <button className={styles.cancelBtn} onClick={cancelEditPoint}>Cancel</button>
                        {editable && editingCode !== NEW_POINT && !delInfo && (
                          <button className={styles.deleteBtn} style={{ marginLeft: 'auto' }} onClick={startDelete}>Delete</button>
                        )}
                      </div>

                      {delInfo && (
                        <div className={styles.formErr} style={{ marginTop: 10, padding: '10px 12px', border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 6 }}>
                          {delInfo.loading && <>Checking where this point is used…</>}
                          {delInfo.error && <>{delInfo.error}</>}
                          {delInfo.usage?.has_transactions && (
                            <>
                              <strong>{editingCode} can't be deleted:</strong> it has recorded transactions, which keep its
                              code as the audit trail. Take it off its routes instead (Setup &gt; Customers &gt; Sites &gt; Routes).
                            </>
                          )}
                          {delInfo.usage && !delInfo.usage.has_transactions && (
                            <>
                              <strong>Delete {editingCode}?</strong> It will be removed from {delInfo.usage.routes} route
                              {delInfo.usage.routes === 1 ? '' : 's'} and its {delInfo.usage.questions} question
                              {delInfo.usage.questions === 1 ? '' : 's'} deleted. This can't be undone.
                              {delInfo.usage.jump_references > 0 && (
                                <> {delInfo.usage.jump_references} question{delInfo.usage.jump_references === 1 ? '' : 's'} on other points jump to it and will be left pointing at nothing.</>
                              )}
                              <div className={styles.formActions}>
                                <button className={styles.deleteBtn} onClick={confirmDelete} disabled={deleting}>
                                  {deleting ? 'Deleting…' : 'Yes, delete'}
                                </button>
                                <button className={styles.cancelBtn} onClick={() => setDelInfo(null)} disabled={deleting}>Keep it</button>
                              </div>
                            </>
                          )}
                          {!delInfo.loading && (delInfo.error || delInfo.usage?.has_transactions) && (
                            <div className={styles.formActions}>
                              <button className={styles.cancelBtn} onClick={() => setDelInfo(null)}>OK</button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 24, maxWidth: 700 }}>
          <p>
            <strong>{result.created}</strong> point{result.created === 1 ? '' : 's'} created,{' '}
            <strong>{result.linked}</strong> existing point{result.linked === 1 ? '' : 's'} linked to this route,{' '}
            <strong>{result.skipped}</strong> skipped
            {result.questions_preloaded > 0 && <> — <strong>{result.questions_preloaded}</strong> question rows preloaded</>}
            {' '}({result.total_rows} row{result.total_rows === 1 ? '' : 's'} read from the file).
          </p>
          {result.skipped > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>Row</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>Point Code</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>Status</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.filter(r => r.status === 'skipped').map(r => (
                  <tr key={r.row}>
                    <td style={{ padding: '4px 8px' }}>{r.row}</td>
                    <td style={{ padding: '4px 8px' }}>{r.point_code ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{r.status}</td>
                    <td style={{ padding: '4px 8px' }}>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
