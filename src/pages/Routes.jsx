import { useEffect, useState } from 'react';
import { getRoutes } from '../api/client';
import styles from './Table.module.css';

export default function Routes() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRoutes({ limit: 200 }).then(setRows).finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>Routes</h2>
      </div>
      {loading ? <div className={styles.loading}>Loading…</div> : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Display Name</th>
                <th>Template</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.route_code}</td>
                  <td>{r.name}</td>
                  <td>{r.display_name || '—'}</td>
                  <td>{r.is_template ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
