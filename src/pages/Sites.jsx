import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSites, getCustomer, createSite, updateSite, deleteSite } from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import Breadcrumb from '../components/Breadcrumb';
import styles from './Drill.module.css';
import formStyles from './Questions.module.css';

const emptyForm = {
  site_code: '', name: '',
  address1: '', address2: '', address3: '',
  city: '', state: '', zip: '',
  contact_name: '', contact_phone: '', emergency_name: '', emergency_phone: '', email: '',
};

function toForm(s) {
  return {
    site_code: s.site_code ?? '',
    name: s.name ?? '',
    address1: s.address1 ?? '',
    address2: s.address2 ?? '',
    address3: s.address3 ?? '',
    city: s.city ?? '',
    state: s.state ?? '',
    zip: s.zip ?? '',
    contact_name: s.contact_name ?? '',
    contact_phone: s.contact_phone ?? '',
    emergency_name: s.emergency_name ?? '',
    emergency_phone: s.emergency_phone ?? '',
    email: s.email ?? '',
  };
}

export default function Sites() {
  const { customerId } = useParams();
  const { me, unrestricted } = useCanEditSite();
  const [rows, setRows]         = useState([]);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [sortMode, setSortMode] = useState('name'); // 'name' | 'code'
  const navigate = useNavigate();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = creating new, otherwise editing this site's id
  const [form, setForm]         = useState(emptyForm);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr]           = useState(null);

  function load() {
    setLoading(true);
    return Promise.all([
      getSites(customerId ? { customer_id: customerId } : undefined),
      customerId ? getCustomer(customerId) : Promise.resolve(null),
    ]).then(([sites, cust]) => {
      setRows(sites);
      setCustomer(cust);
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const sortedRows = useMemo(() => {
    // Incidents1 is a standalone system site (incident-only routes/points,
    // not a real patrolled site) -- hide it from a customer's site list,
    // same as PdaEmulator.jsx's route picker already does.
    const visible = customerId ? rows.filter(s => s.id !== 'Incidents1' && s.name !== 'Incidents1') : rows;
    if (sortMode === 'code') {
      return [...visible].sort((a, b) => a.site_code.localeCompare(b.site_code));
    }
    return [...visible].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, sortMode, customerId]);

  function startNew() {
    setEditingId(null);
    setForm(emptyForm);
    setErr(null);
    setShowForm(true);
  }

  function startEdit(site, e) {
    e.stopPropagation(); // the card itself navigates to Routes on click
    setEditingId(site.id);
    setForm(toForm(site));
    setErr(null);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body = {
        ...form,
        name: form.name.trim().toUpperCase(),
        address1: form.address1.toUpperCase(),
        address2: form.address2.toUpperCase(),
        address3: form.address3.toUpperCase(),
        city: form.city.toUpperCase(),
        state: form.state.toUpperCase(),
        contact_name: form.contact_name.toUpperCase(),
        emergency_name: form.emergency_name.toUpperCase(),
      };
      if (editingId) {
        delete body.site_code; // immutable once created -- not part of SiteUpdate
        const updated = await updateSite(editingId, body);
        setRows(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        await createSite({ ...body, site_code: form.site_code.trim().toUpperCase(), customer_id: customerId });
        await load();
      }
      setShowForm(false);
      setEditingId(null);
      markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    if (!confirm(`Delete site "${form.name}"? This also removes every route and point underneath it.`)) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteSite(editingId);
      setRows(prev => prev.filter(s => s.id !== editingId));
      setShowForm(false);
      setEditingId(null);
      markPdaFilesDirty();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Delete failed');
      setDeleting(false);
    }
  }

  const crumbs = customerId
    ? [{ label: 'Customers', to: '/setup/customers' }, { label: customer?.name ?? '…' }]
    : null;

  const canEditHere = !me || unrestricted;

  return (
    <div className={styles.page}>
      {crumbs && <Breadcrumb crumbs={crumbs} />}
      <div className={styles.header}>
        <h2 className={styles.heading}>Sites</h2>
        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>Sort by</span>
          <select
            className={styles.sortSelect}
            value={sortMode}
            onChange={e => setSortMode(e.target.value)}
          >
            <option value="name">Name</option>
            <option value="code">Site Code</option>
          </select>
        </div>
        {!showForm && customerId && canEditHere && (
          <button className={formStyles.newBtn} style={{ marginLeft: 'auto' }} onClick={startNew}>+ New Site</button>
        )}
      </div>

      {showForm && (
        <div className={formStyles.form} style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Site Code</label>
              <input className={formStyles.formInput} value={form.site_code} maxLength={10}
                onChange={e => updateField('site_code', e.target.value)} placeholder="e.g. 0000000002"
                disabled={!!editingId} title={editingId ? 'Site code cannot be changed after creation' : undefined} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Name</label>
              <input className={formStyles.formInput} value={form.name} maxLength={20}
                onChange={e => updateField('name', e.target.value)} placeholder="Site name" />
            </div>
          </div>

          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Address 1</label>
              <input className={formStyles.formInput} value={form.address1} maxLength={30}
                onChange={e => updateField('address1', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Address 2</label>
              <input className={formStyles.formInput} value={form.address2} maxLength={30}
                onChange={e => updateField('address2', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Address 3</label>
              <input className={formStyles.formInput} value={form.address3} maxLength={30}
                onChange={e => updateField('address3', e.target.value)} />
            </div>
          </div>

          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>City</label>
              <input className={formStyles.formInput} value={form.city} maxLength={20}
                onChange={e => updateField('city', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>State</label>
              <input className={formStyles.formInput} value={form.state} maxLength={2}
                onChange={e => updateField('state', e.target.value)} style={{ width: 60 }} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Zip</label>
              <input className={formStyles.formInput} value={form.zip} maxLength={10}
                onChange={e => updateField('zip', e.target.value)} style={{ width: 100 }} />
            </div>
          </div>

          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Contact Name</label>
              <input className={formStyles.formInput} value={form.contact_name} maxLength={20}
                onChange={e => updateField('contact_name', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Contact Phone</label>
              <input className={formStyles.formInput} value={form.contact_phone} maxLength={14}
                onChange={e => updateField('contact_phone', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Emergency Name</label>
              <input className={formStyles.formInput} value={form.emergency_name} maxLength={20}
                onChange={e => updateField('emergency_name', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Emergency Phone</label>
              <input className={formStyles.formInput} value={form.emergency_phone} maxLength={14}
                onChange={e => updateField('emergency_phone', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Email</label>
              <input className={formStyles.formInput} type="email" value={form.email} maxLength={60}
                onChange={e => updateField('email', e.target.value)} />
            </div>
          </div>

          {err && <div className={formStyles.formErr}>{err}</div>}

          <div className={formStyles.formActions}>
            <button
              className={formStyles.saveBtn}
              onClick={save}
              disabled={saving || !form.site_code.trim() || !form.name.trim()}
            >
              {saving ? '…' : editingId ? 'Save Changes' : 'Add Site'}
            </button>
            {editingId && (
              <button className={formStyles.deleteBtn} onClick={remove} disabled={deleting}>
                {deleting ? '…' : 'Delete'}
              </button>
            )}
            <button className={formStyles.cancelBtn} onClick={cancelForm}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div className={styles.loading}>Loading…</div> : (
        <div className={styles.cardGrid}>
          {sortedRows.map(site => (
            <div
              key={site.id}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/setup/sites/${site.id}/routes`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/setup/sites/${site.id}/routes`); }}
              style={{ position: 'relative' }}
            >
              {canEditHere && (
                <button
                  className={formStyles.newBtn}
                  style={{ position: 'absolute', top: 8, right: 8, padding: '2px 10px', fontSize: '0.72rem' }}
                  onClick={e => startEdit(site, e)}
                >
                  Edit
                </button>
              )}
              <div className={styles.cardTitle}>{site.name}</div>
              <div className={styles.cardSub}>{site.site_code}</div>
              {site.city && <div className={styles.cardMeta}>{site.city}{site.state ? `, ${site.state}` : ''}</div>}
              {site.contact_name && <div className={styles.cardMeta}>{site.contact_name}</div>}
              <div className={styles.cardArrow}>Routes &rarr;</div>
            </div>
          ))}
          {sortedRows.length === 0 && <div className={styles.empty}>No sites</div>}
        </div>
      )}
    </div>
  );
}
