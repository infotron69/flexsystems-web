import { useEffect, useState } from 'react';
import { getAuditLog } from '../api/client';
import reportStyles from './Report.module.css';
import styles from './Table.module.css';

const ENTITY_TYPES = [
  'Customer', 'Site', 'Route', 'Point', 'Question', 'Operator', 'User',
  'User Site Access', 'Route Point', 'Incident', 'Incident Sub Cat 1', 'Incident Sub Cat 2', 'Incident Sub Cat 3',
];

export default function AuditLog() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState('');
  const [action, setAction]         = useState('');
  const [userCode, setUserCode]     = useState('');

  function load() {
    setLoading(true);
    const params = {};
    if (entityType) params.entity_type = entityType;
    if (action) params.action = action;
    if (userCode) params.user_code = userCode;
    return getAuditLog(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function clearFilters() {
    setEntityType(''); setAction(''); setUserCode('');
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>Audit Trail</h2>
      </div>

      <div className={reportStyles.filterBar} style={{ marginBottom: 14 }}>
        <div className={reportStyles.filterField}>
          <label className={reportStyles.filterLabel}>Entity Type</label>
          <select className={reportStyles.filterSelect} value={entityType} onChange={e => setEntityType(e.target.value)}>
            <option value="">All Types</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className={reportStyles.filterField}>
          <label className={reportStyles.filterLabel}>Action</label>
          <select className={reportStyles.filterSelect} value={action} onChange={e => setAction(e.target.value)}>
            <option value="">All Actions</option>
            <option value="CREATE">Create</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
          </select>
        </div>
        <div className={reportStyles.filterField}>
          <label className={reportStyles.filterLabel}>User</label>
          <input
            className={reportStyles.filterInput}
            value={userCode}
            onChange={e => setUserCode(e.target.value)}
            placeholder="User code"
          />
        </div>
        <button className={reportStyles.filterBtn} onClick={load} disabled={loading}>
          {loading ? '…' : 'Apply'}
        </button>
        <button className={reportStyles.clearBtn} onClick={() => { clearFilters(); load(); }}>Clear</button>
      </div>

      {loading ? <div className={styles.loading}>Loading…</div> : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Type</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.timestamp.replace('T', ' ').slice(0, 19)}</td>
                  <td>{r.user_code || '—'}</td>
                  <td>{r.action}</td>
                  <td>{r.entity_type}</td>
                  <td>{r.entity_label || r.entity_id || '—'}</td>
                  <td>{r.description || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className={styles.empty}>No audit entries match these filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
