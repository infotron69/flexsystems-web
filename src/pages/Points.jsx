import { useEffect, useState } from 'react';
import { getPoints } from '../api/client';
import styles from './Table.module.css';

export default function Points() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    setLoading(true);
    getPoints({ limit: LIMIT, skip: page * LIMIT })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>Points</h2>
      </div>
      {loading ? <div className={styles.loading}>Loading…</div> : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Tag Type</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.point_code}</td>
                    <td>{r.description}</td>
                    <td>{r.tag_type || '—'}</td>
                    <td className={styles.truncate}>{r.location || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pager}>
            <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}>&larr; Prev</button>
            <span>Page {page + 1}</span>
            <button onClick={() => setPage(p => p+1)} disabled={rows.length < LIMIT}>Next &rarr;</button>
          </div>
        </>
      )}
    </div>
  );
}
