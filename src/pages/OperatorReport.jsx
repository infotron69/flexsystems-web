import { useEffect, useState, useMemo } from 'react';
import { getGuards } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import FindSortBar from '../components/FindSortBar';
import { downloadCsv } from '../utils/exportCsv';
import styles from './Report.module.css';

const COLUMNS = [
  { key: 'card_number',      label: 'Card #' },
  { key: 'last_name',        label: 'Last Name' },
  { key: 'first_name',       label: 'First Name' },
  { key: 'employee_number',  label: 'Employee #' },
  { key: 'phone',            label: 'Phone' },
  { key: 'city',             label: 'City / State' },
];

export default function OperatorReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    getGuards().then(setRows).finally(() => setLoading(false));
  }, []);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    const lc = search.trim().toLowerCase();
    const list = rows.filter(g =>
      (!lc || [g.last_name, g.first_name, g.card_number, g.employee_number, g.phone, g.city, g.state]
        .some(v => (v ?? '').toLowerCase().includes(lc)))
    );
    list.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rows, search, sortKey, sortDir]);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  function handleExport() {
    const headers = [...COLUMNS.map(c => c.label), 'Supervisor'];
    const rows = filtered.map(g => [
      g.card_number, g.last_name, g.first_name || '', g.employee_number || '', g.phone || '',
      g.city ? `${g.city}${g.state ? ', ' + g.state : ''}` : '',
      g.supervisor === 'Y' ? 'Y' : '',
    ]);
    downloadCsv('operator-setup', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Operator Setup" subtitle="Operator roster — sortable, filterable" onExport={handleExport} />
      <div className={styles.meta}>Generated {now} — {filtered.length} of {rows.length} operators</div>

      <div className={styles.filterBar}>
        <FindSortBar
          find={search} onFind={setSearch} placeholder="Name, card #, phone, city…"
          sortKey={sortKey} onSortKey={setSortKey}
          sortDir={sortDir} onSortDir={setSortDir}
          sortOptions={COLUMNS.map(c => ({ key: c.key, label: c.label }))}
        />
      </div>

      <div className={styles.section}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key} className={styles.sortHeader} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sortKey === col.key && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
              <th>Supervisor</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(g => (
              <tr key={g.id}>
                <td>{g.card_number}</td>
                <td>{g.last_name}</td>
                <td>{g.first_name || '—'}</td>
                <td>{g.employee_number || '—'}</td>
                <td>{g.phone || '—'}</td>
                <td>{g.city ? `${g.city}${g.state ? ', ' + g.state : ''}` : '—'}</td>
                <td>{g.supervisor === 'Y' ? 'Y' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className={styles.empty}>No operators match these filters</div>}
      </div>
      <ReportFooter />
    </div>
  );
}
