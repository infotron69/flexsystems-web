import { useEffect, useState, useMemo } from 'react';
import {
  getCustomers, getSites, getRoutes, getRoutePoints, getRoutePointQuestionCounts,
  importPoints, getPoints, getPoint, updatePoint,
} from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './Questions.module.css';

const emptyEditForm = {
  description: '', location: '', category: '', subCategory: '',
  notes1: '', notes2: '', notes3: '', notes4: '', notes5: '',
};

export default function ImportPoints() {
  const { canEdit } = useCanEditSite();

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

  function startEditPoint(pointId) {
    setEditingCode(pointId);
    setEditForm(emptyEditForm);
    setEditErr(null);
    setEditLoading(true);
    getPoint(pointId)
      .then(p => setEditForm({
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

  function cancelEditPoint() {
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
    try {
      const updated = await updatePoint(editingCode, {
        description: editForm.description.trim().toUpperCase(),
        location:    editForm.location.trim().toUpperCase() || null,
        category:     editForm.category.trim().toUpperCase() || null,
        sub_category: editForm.subCategory.trim().toUpperCase() || null,
        notes1:      editForm.notes1.trim().toUpperCase() || null,
        notes2:      editForm.notes2.trim().toUpperCase() || null,
        notes3:      editForm.notes3.trim().toUpperCase() || null,
        notes4:      editForm.notes4.trim().toUpperCase() || null,
        notes5:      editForm.notes5.trim().toUpperCase() || null,
      });
      setSitePoints(prev => prev.map(p => p.id === editingCode ? updated : p));
      // The point's description may also be embedded in the route lists
      // currently on screen (preload options, allocated-points panel).
      setRoutePoints(prev => prev.map(rp => rp.point_id === editingCode
        ? { ...rp, point: { ...rp.point, description: updated.description, location: updated.location, category: updated.category, sub_category: updated.sub_category } }
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

  const sortedSitePoints = useMemo(
    () => [...sitePoints].sort((a, b) => a.point_code.localeCompare(b.point_code)),
    [sitePoints]
  );

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
          <h3 style={{ marginBottom: 8 }}>Edit Points</h3>
          {sortedSitePoints.length === 0 ? (
            <div className={styles.empty}>No points for this site yet.</div>
          ) : (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div className={styles.listBox} style={{ maxHeight: 320, overflowY: 'auto', minWidth: 280, flex: '1 1 280px' }}>
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
                        <div>{editingCode}</div>
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
                            disabled={editSaving || !editForm.description.trim()}
                          >
                            {editSaving ? '…' : 'Save'}
                          </button>
                        )}
                        <button className={styles.cancelBtn} onClick={cancelEditPoint}>Cancel</button>
                      </div>
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
