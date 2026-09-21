import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGuards, createGuard, updateGuard, deleteGuard } from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './Questions.module.css';

const emptyForm = {
  card_number: '', last_name: '', first_name: '', rank: '', employee_number: '',
  phone: '', address1: '', address2: '', city: '', state: '', zip: '', supervisor: '',
};

function toForm(g) {
  return {
    card_number:     g.card_number ?? '',
    last_name:       g.last_name ?? '',
    first_name:      g.first_name ?? '',
    rank:            g.rank ?? '',
    employee_number: g.employee_number ?? '',
    phone:           g.phone ?? '',
    address1:        g.address1 ?? '',
    address2:        g.address2 ?? '',
    city:            g.city ?? '',
    state:           g.state ?? '',
    zip:             g.zip ?? '',
    supervisor:      g.supervisor ?? '',
  };
}

export default function Guards() {
  const navigate = useNavigate();
  const { hasAnyEditAccess: editable } = useCanEditSite();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [sortMode, setSortMode] = useState('name'); // 'name' | 'card' | 'employee'

  const [selId, setSelId]   = useState(null);
  const [form, setForm]     = useState(emptyForm);
  const [isNew, setIsNew]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  function load() {
    setLoading(true);
    return getGuards({ limit: 500 }).then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => {
    getGuards({ limit: 500 }).then(setRows).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const lc = filter.toLowerCase();
    const list = !filter ? rows : rows.filter(g =>
      g.last_name.toLowerCase().includes(lc) ||
      (g.first_name ?? '').toLowerCase().includes(lc) ||
      g.card_number.toLowerCase().includes(lc) ||
      (g.employee_number ?? '').toLowerCase().includes(lc)
    );

    if (sortMode === 'card') {
      return [...list].sort((a, b) => a.card_number.localeCompare(b.card_number));
    }
    if (sortMode === 'employee') {
      return [...list].sort((a, b) => {
        const eA = a.employee_number ?? '', eB = b.employee_number ?? '';
        if (!eA) return 1;
        if (!eB) return -1;
        return eA.localeCompare(eB);
      });
    }
    // Default: Last Name, then First Name.
    return [...list].sort((a, b) => {
      const lastCmp = a.last_name.localeCompare(b.last_name);
      if (lastCmp !== 0) return lastCmp;
      return (a.first_name ?? '').localeCompare(b.first_name ?? '');
    });
  }, [filter, rows, sortMode]);

  function selectGuard(g) {
    setSelId(g.id);
    setIsNew(false);
    setForm(toForm(g));
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
      if (isNew) {
        const created = await createGuard({
          ...form,
          card_number: form.card_number.trim().toUpperCase(),
          last_name: form.last_name.trim().toUpperCase(),
          first_name: form.first_name.toUpperCase(),
          rank: form.rank.toUpperCase(),
          employee_number: form.employee_number.toUpperCase(),
          address1: form.address1.toUpperCase(),
          address2: form.address2.toUpperCase(),
          city: form.city.toUpperCase(),
          state: form.state.toUpperCase(),
          supervisor: form.supervisor.toUpperCase(),
        });
        await load();
        selectGuard(created);
      } else {
        const body = {
          last_name: form.last_name.trim().toUpperCase(), first_name: form.first_name.toUpperCase(), rank: form.rank.toUpperCase(),
          employee_number: form.employee_number.toUpperCase(), phone: form.phone,
          address1: form.address1.toUpperCase(), address2: form.address2.toUpperCase(), city: form.city.toUpperCase(),
          state: form.state.toUpperCase(), zip: form.zip, supervisor: form.supervisor.toUpperCase(),
        };
        const updated = await updateGuard(selId, body);
        setRows(prev => prev.map(g => g.id === updated.id ? updated : g));
        selectGuard(updated);
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
    const g = rows.find(r => r.id === selId);
    if (!confirm(`Delete operator "${g?.last_name}, ${g?.first_name ?? ''}"? PDA devices will no longer authenticate this card number.`)) return;
    try {
      await deleteGuard(selId);
      setRows(prev => prev.filter(r => r.id !== selId));
      setSelId(null);
      setIsNew(false);
      setForm(emptyForm);
      markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Delete failed');
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          Operator Setup
          {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
        </h2>
        <button className={styles.backBtn} style={{ marginLeft: 'auto' }} onClick={() => navigate('/setup/reports/operators')}>
          Print Report →
        </button>
      </div>

      <div className={styles.shell}>

        {/* ── Left: operator list ── */}
        <div className={styles.list}>
          <div className={styles.listHeader}>
            <input
              className={styles.filterInput}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter operators…"
            />
            <div className={styles.sortRow}>
              <span className={styles.sortLabel}>Sort by</span>
              <select
                className={styles.sortSelect}
                value={sortMode}
                onChange={e => setSortMode(e.target.value)}
              >
                <option value="name">Name (Last, First)</option>
                <option value="card">Card #</option>
                <option value="employee">Employee #</option>
              </select>
            </div>
          </div>
          <div className={styles.listBox}>
            {filtered.map(g => (
              <div
                key={g.id}
                className={`${styles.listItem} ${selId === g.id ? styles.selected : ''}`}
                onClick={() => selectGuard(g)}
              >
                <span className={styles.qDesc}>{g.last_name}{g.first_name ? `, ${g.first_name}` : ''}</span>
                <span className={styles.qCat}>Card {g.card_number}{g.employee_number ? ` · Emp# ${g.employee_number}` : ''}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>No operators</div>}
          </div>
          {editable && (
            <button className={styles.newBtn} onClick={startNew}>+ New Operator</button>
          )}
        </div>

        {/* ── Right: detail form ── */}
        <div className={styles.detail}>
          {(selId != null || isNew) ? (
            <div className={styles.form}>
            <fieldset disabled={!editable} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Card #</label>
                  <input
                    className={styles.formInput}
                    value={form.card_number}
                    disabled={!isNew}
                    onChange={e => updateField('card_number', e.target.value)}
                    placeholder="e.g. 0000000012"
                    maxLength={10}
                  />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Last Name</label>
                  <input className={styles.formInput} value={form.last_name}
                    onChange={e => updateField('last_name', e.target.value)} maxLength={20} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>First Name</label>
                  <input className={styles.formInput} value={form.first_name}
                    onChange={e => updateField('first_name', e.target.value)} maxLength={20} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Rank</label>
                  <input className={styles.formInput} value={form.rank}
                    onChange={e => updateField('rank', e.target.value)} maxLength={10} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Employee #</label>
                  <input className={styles.formInput} value={form.employee_number}
                    onChange={e => updateField('employee_number', e.target.value)} maxLength={10} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Phone</label>
                  <input className={styles.formInput} value={form.phone}
                    onChange={e => updateField('phone', e.target.value)} maxLength={14} />
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Address 1</label>
                  <input className={styles.formInput} value={form.address1}
                    onChange={e => updateField('address1', e.target.value)} maxLength={30} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Address 2</label>
                  <input className={styles.formInput} value={form.address2}
                    onChange={e => updateField('address2', e.target.value)} maxLength={30} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>City</label>
                  <input className={styles.formInput} value={form.city}
                    onChange={e => updateField('city', e.target.value)} maxLength={20} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>State</label>
                  <input className={styles.formInput} value={form.state}
                    onChange={e => updateField('state', e.target.value)} maxLength={2} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Zip</label>
                  <input className={styles.formInput} value={form.zip}
                    onChange={e => updateField('zip', e.target.value)} maxLength={10} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>&nbsp;</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem' }}>
                    <input type="checkbox" checked={form.supervisor === 'Y'}
                      onChange={e => updateField('supervisor', e.target.checked ? 'Y' : '')} />
                    Supervisor
                  </label>
                </div>
              </div>
            </fieldset>

              {err && <div className={styles.formErr}>{err}</div>}

              <div className={styles.formActions}>
                {editable && (
                  <button
                    className={styles.saveBtn}
                    onClick={save}
                    disabled={saving || !form.card_number.trim() || !form.last_name.trim()}
                  >
                    {saving ? '…' : isNew ? 'Add' : 'Update'}
                  </button>
                )}
                {!isNew && editable && (
                  <button className={styles.deleteBtn} onClick={remove}>Delete</button>
                )}
                {isNew && (
                  <button className={styles.cancelBtn} onClick={() => setIsNew(false)}>Cancel</button>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.noSelection}>
              Select an operator from the list, or click <strong>+ New Operator</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
