import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import styles from './Drill.module.css';
import formStyles from './Questions.module.css';

const emptyForm = {
  customer_code: '', name: '',
  billing_address1: '', billing_address2: '', billing_address3: '',
  billing_city: '', billing_state: '', billing_zip: '',
  contact_name: '', contact_phone: '', emergency_name: '', emergency_phone: '',
};

function toForm(c) {
  return {
    customer_code: c.customer_code ?? '',
    name: c.name ?? '',
    billing_address1: c.billing_address1 ?? '',
    billing_address2: c.billing_address2 ?? '',
    billing_address3: c.billing_address3 ?? '',
    billing_city: c.billing_city ?? '',
    billing_state: c.billing_state ?? '',
    billing_zip: c.billing_zip ?? '',
    contact_name: c.contact_name ?? '',
    contact_phone: c.contact_phone ?? '',
    emergency_name: c.emergency_name ?? '',
    emergency_phone: c.emergency_phone ?? '',
  };
}

export default function Customers() {
  const { me, unrestricted } = useCanEditSite();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState('name'); // 'name' | 'code'
  const navigate = useNavigate();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = creating new, otherwise editing this customer's id
  const [form, setForm]         = useState(emptyForm);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr]           = useState(null);

  function load() {
    setLoading(true);
    return getCustomers().then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const sortedRows = useMemo(() => {
    if (sortMode === 'code') {
      return [...rows].sort((a, b) => a.customer_code.localeCompare(b.customer_code));
    }
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, sortMode]);

  function startNew() {
    setEditingId(null);
    setForm(emptyForm);
    setErr(null);
    setShowForm(true);
  }

  function startEdit(customer, e) {
    e.stopPropagation(); // the card itself navigates to Sites on click
    setEditingId(customer.id);
    setForm(toForm(customer));
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
        billing_address1: form.billing_address1.toUpperCase(),
        billing_address2: form.billing_address2.toUpperCase(),
        billing_address3: form.billing_address3.toUpperCase(),
        billing_city: form.billing_city.toUpperCase(),
        billing_state: form.billing_state.toUpperCase(),
        contact_name: form.contact_name.toUpperCase(),
        emergency_name: form.emergency_name.toUpperCase(),
      };
      if (editingId) {
        delete body.customer_code; // immutable once created -- not part of CustomerUpdate
        const updated = await updateCustomer(editingId, body);
        setRows(prev => prev.map(c => c.id === updated.id ? updated : c));
      } else {
        await createCustomer({ ...body, customer_code: form.customer_code.trim().toUpperCase() });
        await load();
      }
      setShowForm(false);
      setEditingId(null);
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    if (!confirm(`Delete customer "${form.name}"? This also removes every site, route, and point underneath it.`)) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteCustomer(editingId);
      setRows(prev => prev.filter(c => c.id !== editingId));
      setShowForm(false);
      setEditingId(null);
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Delete failed');
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          Customers
          {me && !unrestricted && <span className={styles.viewOnlyBadge}>View only</span>}
        </h2>
        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>Sort by</span>
          <select
            className={styles.sortSelect}
            value={sortMode}
            onChange={e => setSortMode(e.target.value)}
          >
            <option value="name">Name</option>
            <option value="code">Customer Code</option>
          </select>
        </div>
        <button className={formStyles.newBtn} style={{ marginLeft: 'auto' }} onClick={() => navigate('/setup/reports/site-summary')}>
          Print Report →
        </button>
        {!showForm && (!me || unrestricted) && (
          <button className={formStyles.newBtn} onClick={startNew}>+ New Customer</button>
        )}
      </div>

      {showForm && (
        <div className={formStyles.form} style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Customer Code</label>
              <input className={formStyles.formInput} value={form.customer_code} maxLength={10}
                onChange={e => updateField('customer_code', e.target.value)} placeholder="e.g. 0000000002"
                disabled={!!editingId} title={editingId ? 'Customer code cannot be changed after creation' : undefined} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Name</label>
              <input className={formStyles.formInput} value={form.name} maxLength={20}
                onChange={e => updateField('name', e.target.value)} placeholder="Company name" />
            </div>
          </div>

          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Billing Address 1</label>
              <input className={formStyles.formInput} value={form.billing_address1} maxLength={30}
                onChange={e => updateField('billing_address1', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Billing Address 2</label>
              <input className={formStyles.formInput} value={form.billing_address2} maxLength={30}
                onChange={e => updateField('billing_address2', e.target.value)} />
            </div>
          </div>

          <div className={formStyles.formGrid}>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>City</label>
              <input className={formStyles.formInput} value={form.billing_city} maxLength={20}
                onChange={e => updateField('billing_city', e.target.value)} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>State</label>
              <input className={formStyles.formInput} value={form.billing_state} maxLength={2}
                onChange={e => updateField('billing_state', e.target.value)} style={{ width: 60 }} />
            </div>
            <div className={formStyles.formRow}>
              <label className={formStyles.formLabel}>Zip</label>
              <input className={formStyles.formInput} value={form.billing_zip} maxLength={10}
                onChange={e => updateField('billing_zip', e.target.value)} style={{ width: 100 }} />
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
          </div>

          {err && <div className={formStyles.formErr}>{err}</div>}

          <div className={formStyles.formActions}>
            <button
              className={formStyles.saveBtn}
              onClick={save}
              disabled={saving || !form.customer_code.trim() || !form.name.trim()}
            >
              {saving ? '…' : editingId ? 'Save Changes' : 'Add Customer'}
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
          {sortedRows.map(customer => (
            <div
              key={customer.id}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/setup/customers/${customer.id}/sites`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/setup/customers/${customer.id}/sites`); }}
              style={{ position: 'relative' }}
            >
              {(!me || unrestricted) && (
                <button
                  className={formStyles.newBtn}
                  style={{ position: 'absolute', top: 8, right: 8, padding: '2px 10px', fontSize: '0.72rem' }}
                  onClick={e => startEdit(customer, e)}
                >
                  Edit
                </button>
              )}
              <div className={styles.cardTitle}>{customer.name}</div>
              <div className={styles.cardSub}>{customer.customer_code}</div>
              {customer.billing_city && (
                <div className={styles.cardMeta}>
                  {customer.billing_city}{customer.billing_state ? `, ${customer.billing_state}` : ''}
                </div>
              )}
              {customer.contact_name && <div className={styles.cardMeta}>{customer.contact_name}</div>}
              <div className={styles.cardArrow}>Sites &rarr;</div>
            </div>
          ))}
          {rows.length === 0 && <div className={styles.empty}>No customers</div>}
        </div>
      )}
    </div>
  );
}
