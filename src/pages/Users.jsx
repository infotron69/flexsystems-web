import { useEffect, useState, useMemo } from 'react';
import {
  getUsers, createUser, setUserPassword, setUserSites, deleteUser,
  getCustomers, getSites,
} from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import shared from './Questions.module.css';
import styles from './Users.module.css';

const GLOBAL_SOP_SITE_ID = 'Incidents1'; // shared SOP config — not a real, assignable company site

const emptyForm = { user_code: '', password: '', siteAccess: [] };

export default function Users() {
  const { me, unrestricted } = useCanEditSite();
  const [rows, setRows]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites]         = useState([]);
  const [loading, setLoading]     = useState(true);

  const [sortMode, setSortMode] = useState('code'); // 'code' | 'access'
  const [selCode, setSelCode] = useState(null);
  const [isNew, setIsNew]     = useState(false);
  const [form, setForm]       = useState(emptyForm);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);

  function load() {
    setLoading(true);
    return Promise.all([getUsers(), getCustomers(), getSites()])
      .then(([u, c, s]) => { setRows(u); setCustomers(c); setSites(s); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  // Wait for getMe() before fetching -- a restricted user gets a 403 from
  // /auth/users (admin-only), so skip the call entirely once that's known.
  useEffect(() => {
    if (!me) return;
    if (!unrestricted) { setLoading(false); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, unrestricted]);

  const assignableSites = useMemo(
    () => sites.filter(s => s.id !== GLOBAL_SOP_SITE_ID),
    [sites]
  );

  const siteNameById = useMemo(() => {
    const m = new Map();
    for (const s of sites) m.set(s.id, s.name);
    return m;
  }, [sites]);

  function accessLabel(user) {
    if (!user.site_access.length) return 'All Companies';
    return user.site_access
      .map(a => {
        const name = siteNameById.get(a.site_id) || a.site_id;
        if (a.can_edit && a.can_edit_questions) return name;
        if (!a.can_edit && !a.can_edit_questions) return `${name} (view only)`;
        const parts = [];
        if (!a.can_edit) parts.push('routes view only');
        if (!a.can_edit_questions) parts.push('questions view only');
        return `${name} (${parts.join(', ')})`;
      })
      .join(', ');
  }

  const sortedRows = useMemo(() => {
    if (sortMode === 'access') {
      return [...rows].sort((a, b) => accessLabel(a).localeCompare(accessLabel(b)));
    }
    return [...rows].sort((a, b) => a.user_code.localeCompare(b.user_code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortMode, siteNameById]);

  function selectUser(u) {
    setSelCode(u.user_code);
    setIsNew(false);
    setForm({ user_code: u.user_code, password: '', siteAccess: u.site_access.map(a => ({ ...a })) });
    setNewPassword('');
    setErr(null);
  }

  function startNew() {
    setSelCode(null);
    setIsNew(true);
    setForm(emptyForm);
    setNewPassword('');
    setErr(null);
  }

  function toggleSite(siteId) {
    setForm(prev => ({
      ...prev,
      siteAccess: prev.siteAccess.some(a => a.site_id === siteId)
        ? prev.siteAccess.filter(a => a.site_id !== siteId)
        : [...prev.siteAccess, { site_id: siteId, can_edit: true, can_edit_questions: true }],
    }));
  }

  function toggleEditField(siteId, field) {
    setForm(prev => ({
      ...prev,
      siteAccess: prev.siteAccess.map(a => a.site_id === siteId ? { ...a, [field]: !a[field] } : a),
    }));
  }

  function selectAllForCompany(customerId) {
    const ids = assignableSites.filter(s => s.customer_id === customerId).map(s => s.id);
    setForm(prev => {
      const existing = new Set(prev.siteAccess.map(a => a.site_id));
      const added = ids.filter(id => !existing.has(id)).map(id => ({ site_id: id, can_edit: true, can_edit_questions: true }));
      return { ...prev, siteAccess: [...prev.siteAccess, ...added] };
    });
  }

  function clearCompany(customerId) {
    const ids = new Set(assignableSites.filter(s => s.customer_id === customerId).map(s => s.id));
    setForm(prev => ({ ...prev, siteAccess: prev.siteAccess.filter(a => !ids.has(a.site_id)) }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      if (isNew) {
        const created = await createUser({
          user_code: form.user_code.trim(),
          password: form.password,
          site_access: form.siteAccess,
        });
        await load();
        selectUser(created);
      } else {
        const updated = await setUserSites(selCode, form.siteAccess);
        setRows(prev => prev.map(u => u.user_code === updated.user_code ? updated : u));
        selectUser(updated);
      }
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!newPassword.trim()) return;
    setErr(null);
    try {
      await setUserPassword(selCode, newPassword.trim());
      setNewPassword('');
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Password reset failed');
    }
  }

  async function remove() {
    if (!selCode) return;
    if (!confirm(`Delete user "${selCode}"? They will no longer be able to log in.`)) return;
    try {
      await deleteUser(selCode);
      setRows(prev => prev.filter(u => u.user_code !== selCode));
      setSelCode(null);
      setIsNew(false);
      setForm(emptyForm);
    } catch (ex) {
      setErr(ex.response?.data?.detail ?? 'Delete failed');
    }
  }

  if (loading) return <div className={shared.page}><div className={shared.loading}>Loading…</div></div>;

  if (me && !unrestricted) {
    return (
      <div className={shared.page}>
        <div className={shared.header}><h2 className={shared.heading}>User Setup</h2></div>
        <div className={shared.formErr}>Admin access required — this account is restricted to specific sites.</div>
      </div>
    );
  }

  const isAllCompanies = form.siteAccess.length === 0;

  return (
    <div className={shared.page}>
      <div className={shared.header}>
        <h2 className={shared.heading}>User Setup</h2>
      </div>

      <div className={shared.shell}>

        {/* ── Left: user list ── */}
        <div className={shared.list}>
          <div className={shared.listHeader}>
            <div className={shared.sortRow}>
              <span className={shared.sortLabel}>Sort by</span>
              <select
                className={shared.sortSelect}
                value={sortMode}
                onChange={e => setSortMode(e.target.value)}
              >
                <option value="code">User Code</option>
                <option value="access">Company Access</option>
              </select>
            </div>
          </div>
          <div className={shared.listBox}>
            {sortedRows.map(u => (
              <div
                key={u.user_code}
                className={`${shared.listItem} ${selCode === u.user_code ? shared.selected : ''}`}
                onClick={() => selectUser(u)}
              >
                <span className={shared.qDesc}>{u.user_code}</span>
                <span className={shared.qCat}>{accessLabel(u)}</span>
              </div>
            ))}
            {rows.length === 0 && <div className={shared.empty}>No users</div>}
          </div>
          <button className={shared.newBtn} onClick={startNew}>+ New User</button>
        </div>

        {/* ── Right: detail form ── */}
        <div className={shared.detail}>
          {(selCode != null || isNew) ? (
            <div className={shared.form}>
              <div className={shared.formRow}>
                <label className={shared.formLabel}>User Code</label>
                <input
                  className={shared.formInput}
                  value={form.user_code}
                  disabled={!isNew}
                  onChange={e => setForm(prev => ({ ...prev, user_code: e.target.value }))}
                  placeholder="e.g. JSMITH"
                  maxLength={20}
                />
              </div>

              {isNew && (
                <div className={shared.formRow}>
                  <label className={shared.formLabel}>Password</label>
                  <input
                    className={shared.formInput}
                    type="password"
                    value={form.password}
                    onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                  />
                </div>
              )}

              {!isNew && (
                <div className={styles.passwordRow}>
                  <label className={shared.formLabel}>Reset Password</label>
                  <div className={styles.passwordControls}>
                    <input
                      className={shared.formInput}
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="New password"
                    />
                    <button className={shared.cancelBtn} onClick={resetPassword} disabled={!newPassword.trim()}>
                      Set Password
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.accessSection}>
                <label className={shared.formLabel}>Company Access</label>
                <div className={styles.accessToggle}>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      checked={isAllCompanies}
                      onChange={() => setForm(prev => ({ ...prev, siteAccess: [] }))}
                    />
                    All Companies (unrestricted)
                  </label>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      checked={!isAllCompanies}
                      onChange={() => {
                        if (isAllCompanies && customers[0]) selectAllForCompany(customers[0].id);
                      }}
                    />
                    Specific companies / sites
                  </label>
                </div>

                {!isAllCompanies && (
                  <div className={styles.companyList}>
                    {customers.map(c => {
                      const custSites = assignableSites.filter(s => s.customer_id === c.id);
                      return (
                        <div key={c.id} className={styles.companyBlock}>
                          <div className={styles.companyHeader}>
                            <span className={styles.companyName}>{c.name}</span>
                            <button className={styles.linkBtn} onClick={() => selectAllForCompany(c.id)}>All sites</button>
                            <button className={styles.linkBtn} onClick={() => clearCompany(c.id)}>None</button>
                          </div>
                          <div className={styles.siteGrid}>
                            {custSites.map(s => {
                              const access = form.siteAccess.find(a => a.site_id === s.id);
                              return (
                                <div key={s.id} className={styles.siteCheck}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={!!access}
                                      onChange={() => toggleSite(s.id)}
                                    />
                                    {s.name}
                                  </label>
                                  {access && (
                                    <span className={styles.pillGroup}>
                                      <button
                                        type="button"
                                        className={access.can_edit ? styles.editPill : styles.viewPill}
                                        onClick={() => toggleEditField(s.id, 'can_edit')}
                                        title="Routes & Points -- click to toggle between edit and view-only"
                                      >
                                        Routes: {access.can_edit ? 'Edit' : 'View'}
                                      </button>
                                      <button
                                        type="button"
                                        className={access.can_edit_questions ? styles.editPill : styles.viewPill}
                                        onClick={() => toggleEditField(s.id, 'can_edit_questions')}
                                        title="Point Questions -- click to toggle between edit and view-only"
                                      >
                                        Questions: {access.can_edit_questions ? 'Edit' : 'View'}
                                      </button>
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {custSites.length === 0 && <span className={shared.qCat}>No sites</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {err && <div className={shared.formErr}>{err}</div>}

              <div className={shared.formActions}>
                <button
                  className={shared.saveBtn}
                  onClick={save}
                  disabled={saving || !form.user_code.trim() || (isNew && !form.password.trim())}
                >
                  {saving ? '…' : isNew ? 'Add' : 'Update Access'}
                </button>
                {!isNew && (
                  <button className={shared.deleteBtn} onClick={remove}>Delete</button>
                )}
                {isNew && (
                  <button className={shared.cancelBtn} onClick={() => setIsNew(false)}>Cancel</button>
                )}
              </div>
            </div>
          ) : (
            <div className={shared.noSelection}>
              Select a user from the list, or click <strong>+ New User</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
