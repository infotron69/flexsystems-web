import { useEffect, useState } from 'react';
import { getMyCompany, updateMyCompany, sendMyTestReport } from '../api/client';
import styles from './AdminTenants.module.css';

const REPORT_TOGGLES = [
  { key: 'daily', label: 'Daily' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'download', label: 'Download' },
  { key: 'invalid_alert', label: 'Invalid Alert' },
];

// A customer admin's view of their own company: the display name and who gets
// the automated report emails. The database and login link are shown but not
// editable here -- those stay with FlexSystems (Customers & Databases).
export default function MyCompany() {
  const [company, setCompany] = useState(null);
  const [label, setLabel] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null); // { sending } | { ok, message }

  useEffect(() => {
    getMyCompany()
      .then(c => {
        setCompany(c);
        setLabel(c.label);
        setRecipients((c.report_recipients || []).map(r => ({ ...r })));
      })
      .catch(ex => setErr(ex.response?.data?.detail ?? 'Could not load your company settings'));
  }, []);

  function addRecipient() {
    setRecipients(prev => [...prev, { email: '', daily: true, monthly: false, download: false, invalid_alert: false }]);
    setMsg(null);
  }

  function updateRecipient(index, key, value) {
    setRecipients(prev => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
    setMsg(null);
  }

  function removeRecipient(index) {
    setRecipients(prev => prev.filter((_, i) => i !== index));
    setMsg(null);
  }

  // Same convenience as the flex admin screen: a pasted comma-separated list
  // becomes separate rows (same toggles) instead of one malformed address.
  function splitRecipientEmail(index, value) {
    if (!/[,;]/.test(value)) return;
    const emails = value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (emails.length <= 1) return;
    setRecipients(prev => {
      const next = [...prev];
      next.splice(index, 1, ...emails.map(email => ({ ...prev[index], email })));
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const saved = await updateMyCompany({
        label: label.trim(),
        report_recipients: recipients.map(r => ({ ...r, email: r.email.trim() })).filter(r => r.email),
      });
      setCompany(saved);
      setLabel(saved.label);
      setRecipients((saved.report_recipients || []).map(r => ({ ...r })));
      localStorage.setItem('tenantLabel', saved.label);
      setMsg('Saved.');
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTest({ sending: true });
    try {
      const res = await sendMyTestReport();
      setTest({ ok: true, message: `Sent to ${res.sent_to.join(', ')}` });
    } catch (ex) {
      setTest({ ok: false, message: ex.response?.data?.detail ?? 'Failed' });
    }
  }

  if (!company) {
    return (
      <div className={styles.page}>
        {err ? <div className={styles.formErr}>{err}</div> : <div className={styles.loading}>Loading…</div>}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Company &amp; Reports</h2>
      <p className={styles.subheading}>
        Your company name and who receives the automated report emails.
      </p>

      <div className={styles.form}>
        <h3 className={styles.formTitle}>Edit {company.label}</h3>
        {err && <div className={styles.formErr}>{err}</div>}

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Customer Name</label>
          <input className={styles.formInput} value={label} onChange={e => { setLabel(e.target.value); setMsg(null); }} />
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Login Link</label>
          <div>flexpatrol.flexsystems.net/login/{company.id}</div>
          <span className={styles.formHint}>Set by FlexSystems — contact us to change the link or database.</span>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Report Recipients</label>
          {recipients.length === 0 && <span className={styles.formHint}>No recipients yet — add one below.</span>}
          {recipients.map((r, i) => (
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
                    <input type="checkbox" checked={!!r[rt.key]} onChange={e => updateRecipient(i, rt.key, e.target.checked)} />
                    {rt.label}
                  </label>
                ))}
              </div>
              {r.user_code && <span className={styles.formHint} title="This is that user's own email — also editable on User Setup">User {r.user_code}</span>}
              <button type="button" className={styles.removeBtn} onClick={() => removeRecipient(i)} aria-label="Remove recipient">×</button>
            </div>
          ))}
          <button type="button" className={styles.addRecipientBtn} onClick={addRecipient}>+ Add Recipient</button>
          <span className={styles.formHint}>Daily/Monthly: scheduled report emails. Download: sent after each PDA sync. Invalid Alert: sent only when a sync contains a Fail, Missed point, or exception answer.</span>
        </div>

        <div className={styles.formActions}>
          <button className={styles.saveBtn} onClick={save} disabled={saving || !label.trim()}>
            {saving ? '…' : 'Save Changes'}
          </button>
          <button className={styles.cancelBtn} onClick={sendTest} disabled={test?.sending}>
            {test?.sending ? 'Sending…' : 'Send Test Email'}
          </button>
          {msg && <span className={styles.status}>{msg}</span>}
        </div>
        {test?.message && <div className={test.ok ? styles.status : styles.statusErr}>{test.message}</div>}
        <span className={styles.formHint}>Send Test Email sends today's daily report to the Daily recipients as last saved.</span>
      </div>
    </div>
  );
}
