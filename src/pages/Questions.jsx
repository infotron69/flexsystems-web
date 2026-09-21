import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllQuestions, createQuestion, updateQuestion, deleteQuestion } from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './Questions.module.css';

const TYPE_OPTIONS = [
  { value: '1',  label: '1 — YES/NO' },
  { value: '2',  label: '2 — MULTICHOICE' },
  { value: '3',  label: '3 — ALPHA/NUM' },
  { value: '4',  label: '4 — LOW/NORMAL/HIGH' },
  { value: '5',  label: '5 — MULTISELECT' },
  { value: '6',  label: '6 — SHOWFILE' },
  { value: '7',  label: '7 — ASSET SCAN' },
  { value: '8',  label: '8 — PICKLIST' },
  { value: '9',  label: '9 — CLONE JUMP' },
  { value: '10', label: '10 — SIGNATURE CAPTURE' },
  { value: '11', label: '11 — PHOTO' },
];

// PickList "Type" field (Field8) — real data uses these two values.
const PICKLIST_TYPE_OPTIONS = ['LookupType', 'TreeType'];

const emptyForm = {
  description: '', category: '', subcategory: '', question_type: '1',
  option1: '', option2: '', option3: '', option4: '', option5: '',
  mask: '', high_alarm: '', low_alarm: '', default_response: '', file_name: '',
};

function toForm(q) {
  return {
    description:      q.description ?? '',
    category:         q.category ?? '',
    subcategory:      q.subcategory ?? '',
    question_type:    q.question_type ?? '1',
    option1:          q.option1 ?? '',
    option2:          q.option2 ?? '',
    option3:          q.option3 ?? '',
    option4:          q.option4 ?? '',
    option5:          q.option5 ?? '',
    mask:             q.mask ?? '',
    high_alarm:       q.high_alarm ?? '',
    low_alarm:        q.low_alarm ?? '',
    default_response: q.default_response ?? '',
    file_name:        q.file_name ?? '',
  };
}

export default function Questions() {
  const navigate = useNavigate();
  const { hasAnyEditAccess: editable } = useCanEditSite();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [sortMode, setSortMode] = useState('category'); // 'category' | 'description'
  const [categoryFilter, setCategoryFilter]       = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [typeFilter, setTypeFilter]               = useState('');

  const [selId, setSelId]   = useState(null);
  const [form, setForm]     = useState(emptyForm);
  const [isNew, setIsNew]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  // Multi-select (for bulk delete) -- independent of selId, which tracks the
  // single question currently open in the detail form.
  const [selIds, setSelIds]     = useState(() => new Set());
  const [selAnchor, setSelAnchor] = useState(null);

  function load() {
    setLoading(true);
    return getAllQuestions().then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const categoryOptions = useMemo(
    () => [...new Set(rows.map(q => q.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const subcategoryOptions = useMemo(
    () => [...new Set(
      rows.filter(q => !categoryFilter || q.category === categoryFilter).map(q => q.subcategory).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b)),
    [rows, categoryFilter]
  );

  function selectCategoryFilter(value) {
    setCategoryFilter(value);
    setSubcategoryFilter(''); // subcategory options depend on category -- stale selection wouldn't apply
  }

  const filtered = useMemo(() => {
    const lc = filter.toLowerCase();
    let list = rows;
    if (categoryFilter) list = list.filter(q => q.category === categoryFilter);
    if (subcategoryFilter) list = list.filter(q => q.subcategory === subcategoryFilter);
    if (typeFilter) list = list.filter(q => q.question_type === typeFilter);
    if (filter) list = list.filter(q =>
      q.description.toLowerCase().includes(lc) ||
      (q.category ?? '').toLowerCase().includes(lc) ||
      (q.subcategory ?? '').toLowerCase().includes(lc)
    );
    if (sortMode === 'description') {
      return [...list].sort((a, b) => a.description.localeCompare(b.description));
    }

    // Group by Category, then Sub-Category, then Description -- uncategorized
    // questions sort last within each level rather than first.
    return [...list].sort((a, b) => {
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
  }, [filter, rows, sortMode, categoryFilter, subcategoryFilter, typeFilter]);

  function selectQuestion(q) {
    setSelId(q.id);
    setIsNew(false);
    setForm(toForm(q));
    setErr(null);
  }

  function startNew() {
    setSelId(null);
    setIsNew(true);
    setForm(emptyForm);
    setErr(null);
  }

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      // mask is left as-typed -- it's a device-side input mask (e.g. legacy
      // "A"/"9" placeholder syntax) where case can be semantically
      // significant, unlike every other free-text field here.
      const body = {
        ...form,
        description:      form.description.trim().toUpperCase(),
        category:         form.category.trim().toUpperCase(),
        subcategory:      form.subcategory.trim().toUpperCase(),
        option1:          form.option1.toUpperCase(),
        option2:          form.option2.toUpperCase(),
        option3:          form.option3.toUpperCase(),
        option4:          form.option4.toUpperCase(),
        option5:          form.option5.toUpperCase(),
        // Real PDA answers arrive upper-cased, so a non-upper default_response
        // would make every correct answer register as an exception.
        default_response: form.default_response.toUpperCase(),
      };
      if (isNew) {
        const created = await createQuestion(body);
        await load();
        selectQuestion(created);
      } else {
        const updated = await updateQuestion(selId, body);
        setRows(prev => prev.map(q => q.id === updated.id ? updated : q));
        selectQuestion(updated);
      }
      markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selId) return;
    const q = rows.find(r => r.id === selId);
    if (!confirm(`Delete question "${q?.description}"? This may affect route/point assignments using it.`)) return;
    try {
      await deleteQuestion(selId);
      setRows(prev => prev.filter(r => r.id !== selId));
      setSelId(null);
      setIsNew(false);
      setForm(emptyForm);
      setSelIds(new Set());
      setSelAnchor(null);
      markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Delete failed');
    }
  }

  // ── Multi-select click handling (mirrors RouteSetup.jsx's point lists) ──────
  // Plain click = replace selection (and open it in the detail form);
  // ctrl/cmd+click = toggle one; shift+click = range from the last click.
  function clickQuestion(q, index, e) {
    if (e.shiftKey && selAnchor != null) {
      const [lo, hi] = selAnchor < index ? [selAnchor, index] : [index, selAnchor];
      setSelIds(new Set(filtered.slice(lo, hi + 1).map(it => it.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelIds(prev => {
        const next = new Set(prev);
        next.has(q.id) ? next.delete(q.id) : next.add(q.id);
        return next;
      });
      setSelAnchor(index);
    } else {
      setSelIds(new Set([q.id]));
      setSelAnchor(index);
      selectQuestion(q);
    }
  }

  async function removeSelected() {
    if (selIds.size === 0) return;
    const label = selIds.size === 1
      ? `question "${rows.find(r => selIds.has(r.id))?.description}"`
      : `${selIds.size} questions`;
    if (!confirm(`Delete ${label}? This may affect route/point assignments using them.`)) return;
    try {
      await Promise.all([...selIds].map(id => deleteQuestion(id)));
      setRows(prev => prev.filter(r => !selIds.has(r.id)));
      if (selId != null && selIds.has(selId)) {
        setSelId(null);
        setIsNew(false);
        setForm(emptyForm);
      }
      setSelIds(new Set());
      setSelAnchor(null);
      markPdaFilesDirty();
    } catch (ex) {
      alert('Delete failed: ' + (ex.response?.data?.detail ?? ex.message));
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
        <h2 className={styles.heading}>
          Question Setup
          {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
        </h2>
        <button className={styles.backBtn} style={{ marginLeft: 'auto' }} onClick={() => navigate('/setup/reports/questions')}>
          Print Report →
        </button>
      </div>

      <div className={styles.shell}>

        {/* ── Left: question list ── */}
        <div className={styles.list}>
          <div className={styles.listHeader}>
            <input
              className={styles.filterInput}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter questions…"
            />
            <div className={styles.sortRow}>
              <span className={styles.sortLabel}>Sort by</span>
              <select
                className={styles.sortSelect}
                value={sortMode}
                onChange={e => setSortMode(e.target.value)}
              >
                <option value="category">Category / Sub-Category</option>
                <option value="description">Description (A–Z)</option>
              </select>
            </div>
            <div className={styles.sortRow}>
              <span className={styles.sortLabel}>Category</span>
              <select
                className={styles.sortSelect}
                value={categoryFilter}
                onChange={e => selectCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className={styles.sortRow}>
              <span className={styles.sortLabel}>Sub-Cat</span>
              <select
                className={styles.sortSelect}
                value={subcategoryFilter}
                onChange={e => setSubcategoryFilter(e.target.value)}
                disabled={subcategoryOptions.length === 0}
              >
                <option value="">All Sub-Categories</option>
                {subcategoryOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className={styles.sortRow}>
              <span className={styles.sortLabel}>Type</span>
              <select
                className={styles.sortSelect}
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <option value="">All Types</option>
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.listBox}>
            {filtered.map((q, index) => (
              <div
                key={q.id}
                className={`${styles.listItem} ${selIds.has(q.id) ? styles.selected : ''}`}
                onClick={e => clickQuestion(q, index, e)}
              >
                <span className={styles.qDesc}>{q.description}</span>
                {q.category && <span className={styles.qCat}>{q.category}{q.subcategory ? ` / ${q.subcategory}` : ''}</span>}
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>No questions</div>}
          </div>
          {editable && (
            <div className={styles.formActions}>
              <button className={styles.newBtn} onClick={startNew}>+ New Question</button>
              {selIds.size > 1 && (
                <button className={styles.deleteBtn} onClick={removeSelected}>
                  Delete Selected ({selIds.size})
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Right: detail form ── */}
        <div className={styles.detail}>
          {(selId != null || isNew) ? (
            <div className={styles.form}>
            <fieldset disabled={!editable} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Description</label>
                <input
                  className={styles.formInputWide}
                  value={form.description}
                  onChange={e => updateField('description', e.target.value)}
                  placeholder="Question text"
                  maxLength={30}
                />
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Category</label>
                  <input className={styles.formInput} value={form.category}
                    onChange={e => updateField('category', e.target.value)} maxLength={10} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Subcategory</label>
                  <input className={styles.formInput} value={form.subcategory}
                    onChange={e => updateField('subcategory', e.target.value)} maxLength={10} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Type</label>
                  <select className={styles.formSelect} value={form.question_type}
                    onChange={e => updateField('question_type', e.target.value)}>
                    {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              {(form.question_type === '2' || form.question_type === '5') && (
                <div className={styles.formGrid}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div className={styles.formRow} key={i}>
                      <label className={styles.formLabel}>Option {i}</label>
                      <input
                        className={styles.formInput}
                        value={form[`option${i}`]}
                        onChange={e => updateField(`option${i}`, e.target.value)}
                        maxLength={50}
                      />
                    </div>
                  ))}
                </div>
              )}

              {form.question_type === '4' && (
                <div className={styles.formGrid}>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>High Alarm</label>
                    <input className={styles.formInput} value={form.high_alarm}
                      onChange={e => updateField('high_alarm', e.target.value)} maxLength={20} />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Low Alarm</label>
                    <input className={styles.formInput} value={form.low_alarm}
                      onChange={e => updateField('low_alarm', e.target.value)} maxLength={20} />
                  </div>
                </div>
              )}

              {form.question_type === '6' && (
                <div className={styles.formGrid}>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Filename</label>
                    <input className={styles.formInput} value={form.file_name}
                      placeholder="Filename.ext"
                      onChange={e => updateField('file_name', e.target.value)} maxLength={255} />
                  </div>
                </div>
              )}

              {form.question_type === '8' && (
                <div className={styles.formGrid}>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>List File Name</label>
                    <input className={styles.formInput} value={form.option1}
                      placeholder="SampleLookupList.XML"
                      onChange={e => updateField('option1', e.target.value)} maxLength={50} />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>List Node</label>
                    <input className={styles.formInput} value={form.option2}
                      placeholder="/LookupList or /Rollups/SiteRollup"
                      onChange={e => updateField('option2', e.target.value)} maxLength={50} />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Type</label>
                    <select className={styles.formSelect} value={form.option3}
                      onChange={e => updateField('option3', e.target.value)}>
                      <option value="">—</option>
                      {PICKLIST_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Lookup Name</label>
                    <input className={styles.formInput} value={form.option4}
                      placeholder="e.g. Fire Extinguisher (blank for rollups)"
                      onChange={e => updateField('option4', e.target.value)} maxLength={50} />
                  </div>
                </div>
              )}

              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Mask</label>
                  <input className={styles.formInput} value={form.mask}
                    onChange={e => updateField('mask', e.target.value)} maxLength={40} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Default Response</label>
                  <input className={styles.formInput} value={form.default_response}
                    onChange={e => updateField('default_response', e.target.value)} maxLength={50} />
                </div>
              </div>

            </fieldset>

              {err && <div className={styles.formErr}>{err}</div>}

              <div className={styles.formActions}>
                {editable && (
                  <button
                    className={styles.saveBtn}
                    onClick={save}
                    disabled={saving || !form.description.trim()}
                  >
                    {saving ? '…' : isNew ? 'Add' : 'Update'}
                  </button>
                )}
                {!isNew && editable && (
                  <button className={styles.deleteBtn} onClick={remove}>Delete</button>
                )}
                {isNew && (
                  <button className={styles.cancelBtn} onClick={() => { setIsNew(false); }}>Cancel</button>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.noSelection}>
              Select a question from the list, or click <strong>+ New Question</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
