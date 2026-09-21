import { useEffect, useState } from 'react';
import { getAdminTenants, createAdminTenant, updateAdminTenant, deleteAdminTenant, sendTestReport, getSmtpSettings, updateSmtpSettings } from '../api/client';
import styles from './AdminTenants.module.css';

const REPORT_TOGGLES = [
  { key: 'daily', label: 'Daily' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'download', label: 'Download' },
  { key: 'invalid_alert', label: 'Invalid Alert' },
];

const emptyForm = { id: '', label: '', database: '', recipients: [] };

function toForm(t) {
  return {
    id: t.id,
    label: t.label,
    database: t.database,
    recipients: (t.report_recipients || []).map(r => ({ ...r })),
  };
}

export default function AdminTenants() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [isNew, setIsNew]     = useState(false);
  const [form, setForm]       = useState(emptyForm);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);
  const [testStatus, setTestStatus] = useState({});

  const [smtpForm, setSmtpForm] = useState(null);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpErr, setSmtpErr] = useState(null);
  const [smtpMsg, setSmtpMsg] = useState(null);

  function loadSmtp() {
    return getSmtpSettings().then(s => setSmtpForm({
      host: s.host, port: String(s.port), username: s.username, from_addr: s.from_addr,
      password: '', passwordSet: s.password_set,
    }));
  }

  useEffect(() => { loadSmtp(); }, []);

  function updateSmtpField(key, value) {
    setSmtpForm(prev => ({ ...prev, [key]: value }));
    setSmtpMsg(null);
  }

  async function saveSmtp() {
    setSmtpSaving(true);
    setSmtpErr(null);
    setSmtpMsg(null);
    try {
      const body = {
        host: smtpForm.host.trim(),
        port: Number(smtpForm.port) || 587,
        username: smtpForm.username.trim(),
        from_addr: smtpForm.from_addr.trim(),
      };
      if (smtpForm.password) body.password = smtpForm.password;
      const s = await updateSmtpSettings(body);
      setSmtpForm({ host: s.host, port: String(s.port), username: s.username, from_addr: s.from_addr, password: '', passwordSet: s.password_set });
      setSmtpMsg('Saved.');
    } catch (ex) {
      setSmtpErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSmtpSaving(false);
    }
  }

  function load() {
    setLoading(true);
    return getAdminTenants().then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function startNew() {
    setIsNew(true);
    setEditingId(null);
    setForm(emptyForm);
    setErr(null);
  }

  function startEdit(t) {
    setIsNew(false);
    setEditingId(t.id);
    setForm(toForm(t));
    setErr(null);
  }

  function cancel() {
    setIsNew(false);
    setEditingId(null);
    setErr(null);
  }

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function addRecipient() {
    setForm(prev => ({
      ...prev,
      recipients: [...prev.recipients, { email: '', daily: true, monthly: false, download: false, invalid_alert: false }],
    }));
  }

  function updateRecipient(index, key, value) {
    setForm(prev => ({
      ...prev,
      recipients: prev.recipients.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    }));
  }

  function removeRecipient(index) {
    setForm(prev => ({ ...prev, recipients: prev.recipients.filter((_, i) => i !== index) }));
  }

  // The old Setup screen had a single comma-separated email field, so
  // people are used to pasting a list into one box. If that habit lands in
  // one recipient row here, split it into separate rows (same toggles) on
  // blur rather than saving one malformed multi-address entry.
  function splitRecipientEmail(index, value) {
    if (!/[,;]/.test(value)) return;
    const emails = value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (emails.length <= 1) return;
    setForm(prev => {
      const base = prev.recipients[index];
      const recipients = [...prev.recipients];
      recipients.splice(index, 1, ...emails.map(email => ({ ...base, email })));
      return { ...prev, recipients };
    });
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const recipients = form.recipients
      .map(r => ({ ...r, email: r.email.trim() }))
      .filter(r => r.email);
    try {
      if (isNew) {
        await createAdminTenant({ id: form.id.trim(), label: form.label.trim(), database: form.database.trim(), report_recipients: recipients });
      } else {
        await updateAdminTenant(editingId, { label: form.label.trim(), database: form.database.trim(), report_recipients: recipients });
      }
      await load();
      cancel();
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(t) {
    if (!confirm(`Remove "${t.label}" from the customer registry? This does not delete the database itself, just removes their login access.`)) return;
    try {
      await deleteAdminTenant(t.id);
      await load();
    } catch (ex) {
      alert(ex.response?.data?.detail ?? 'Delete failed');
    }
  }

  async function testEmail(t) {
    setTestStatus(prev => ({ ...prev, [t.id]: { sending: true } }));
    try {
      const res = await sendTestReport(t.id);
      setTestStatus(prev => ({ ...prev, [t.id]: { ok: true, message: `Sent to ${res.sent_to.join(', ')}` } }));
    } catch (ex) {
      setTestStatus(prev => ({ ...prev, [t.id]: { ok: false, message: ex.response?.data?.detail ?? 'Failed' } }));
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Customers &amp; Databases</h2>
      <p className={styles.subheading}>
        Manage which customer databases this app can connect to, their private login links, and automated report recipients.
      </p>

      {smtpForm && (
        <div className={styles.form} style={{ marginBottom: 24 }}>
          <h3 className={styles.formTitle}>Email Settings (SMTP)</h3>
          <p className={styles.formHint} style={{ marginBottom: 10 }}>
            Used to send every automated report email — daily, monthly, download, and invalid-response alerts.
          </p>
          {smtpErr && <div className={styles.formErr}>{smtpErr}</div>}

          <div className={styles.formRow}>
            <label className={styles.formLabel}>SMTP Host</label>
            <input className={styles.formInput} value={smtpForm.host} onChange={e => updateSmtpField('host', e.target.value)} placeholder="e.g. mail.smtp2go.com" />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Port</label>
            <input className={styles.formInput} value={smtpForm.port} onChange={e => updateSmtpField('port', e.target.value)} placeholder="587" />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Username</label>
            <input className={styles.formInput} value={smtpForm.username} onChange={e => updateSmtpField('username', e.target.value)} />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>From Address</label>
            <input className={styles.formInput} value={smtpForm.from_addr} onChange={e => updateSmtpField('from_addr', e.target.value)} />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Password</label>
            <input
              type="password"
              className={styles.formInput}
              value={smtpForm.password}
              onChange={e => updateSmtpField('password', e.target.value)}
              placeholder={smtpForm.passwordSet ? '•••••••• (leave blank to keep current)' : 'no password set'}
            />
          </div>

          <div className={styles.formActions}>
            <button className={styles.saveBtn} onClick={saveSmtp} disabled={smtpSaving || !smtpForm.host.trim() || !smtpForm.username.trim() || !smtpForm.from_addr.trim()}>
              {smtpSaving ? '…' : 'Save Email Settings'}
            </button>
            {smtpMsg && <span className={styles.status}>{smtpMsg}</span>}
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <button className={styles.newBtn} onClick={startNew}>+ Add Customer</button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Login Link</th>
            <th>Customer</th>
            <th>Database</th>
            <th>Report Recipients</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id}>
              <td>/login/{t.id}</td>
              <td>{t.label}</td>
              <td>{t.database}</td>
              <td>
                {(t.report_recipients || []).length === 0 ? '—' : (
                  <ul className={styles.recipientList}>
                    {t.report_recipients.map(r => (
                      <li key={r.email}>
                        {r.email}
                        {' '}
                        {REPORT_TOGGLES.filter(rt => r[rt.key]).map(rt => (
                          <span key={rt.key} className={styles.badge}>{rt.label}</span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.smallBtn} onClick={() => startEdit(t)}>Edit</button>
                  <button className={styles.smallBtn} onClick={() => testEmail(t)} disabled={testStatus[t.id]?.sending}>
                    {testStatus[t.id]?.sending ? 'Sending…' : 'Send Test Email'}
                  </button>
                  <button className={`${styles.smallBtn} ${styles.dangerBtn}`} onClick={() => remove(t)}>Remove</button>
                </div>
                {testStatus[t.id]?.message && (
                  <div className={testStatus[t.id].ok ? styles.status : styles.statusErr}>{testStatus[t.id].message}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(isNew || editingId) && (
        <div className={styles.form}>
          <h3 className={styles.formTitle}>{isNew ? 'Add Customer' : `Edit ${form.label}`}</h3>
          {err && <div className={styles.formErr}>{err}</div>}

          {isNew && (
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Login Slug</label>
              <input className={styles.formInput} value={form.id} onChange={e => updateField('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="e.g. acme" />
              <span className={styles.formHint}>Becomes their private link: flexpatrol.flexsystems.net/login/{form.id || '…'}</span>
            </div>
          )}

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Customer Name</label>
            <input className={styles.formInput} value={form.label} onChange={e => updateField('label', e.target.value)} placeholder="e.g. Acme Corp" />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>SQL Database Name</label>
            <input className={styles.formInput} value={form.database} onChange={e => updateField('database', e.target.value)} placeholder="e.g. Flex_Acme" />
            <span className={styles.formHint}>Must exist on the same SQL Server instance, with FlexAppUser granted access.</span>
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Report Recipients</label>
            {form.recipients.length === 0 && <span className={styles.formHint}>No recipients yet — add one below.</span>}
            {form.recipients.map((r, i) => (
              <div key={i} className={styles.recipientRow}>
                <input
                  className={styles.formInput}
                  value={r.email}
                  onChange={e => updateRecipient(i, 'email', e.target.value)}
                  onBlur={e => splitRecipientEmail(i, e.target.value)}
                  placeholder="email address (or paste a comma-separated list)"
                />
                <div className={styles.toggleGroup}>
                  {REPORT_TOGGLES.map(rt => (
                    <label key={rt.key} className={styles.toggleLabel}>
                      <input
                        type="checkbox"
                        checked={!!r[rt.key]}
                        onChange={e => updateRecipient(i, rt.key, e.target.checked)}
                      />
                      {rt.label}
                    </label>
                  ))}
                </div>
                <button type="button" className={styles.removeBtn} onClick={() => removeRecipient(i)} aria-label="Remove recipient">×</button>
              </div>
            ))}
            <button type="button" className={styles.addRecipientBtn} onClick={addRecipient}>+ Add Recipient</button>
            <span className={styles.formHint}>Daily/Monthly: scheduled report emails. Download: sent after each PDA sync. Invalid Alert: sent only when a sync contains a Fail, Missed point, or exception answer.</span>
          </div>

          <div className={styles.formActions}>
            <button className={styles.saveBtn} onClick={save} disabled={saving || !form.label.trim() || !form.database.trim() || (isNew && !form.id.trim())}>
              {saving ? '…' : isNew ? 'Add Customer' : 'Save Changes'}
            </button>
            <button className={styles.cancelBtn} onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
