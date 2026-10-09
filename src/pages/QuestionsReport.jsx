import { useEffect, useState, useMemo } from 'react';
import { getAllQuestions } from '../api/client';
import ReportHeader from '../components/ReportHeader';
import ReportFooter from '../components/ReportFooter';
import { downloadCsv } from '../utils/exportCsv';
import styles from './Report.module.css';

const TYPE_LABEL = {
  '1': 'YES/NO', '2': 'MULTICHOICE', '3': 'ALPHA/NUM', '4': 'LOW/NORMAL/HIGH',
  '5': 'MULTISELECT', '6': 'SHOWFILE', '7': 'ASSET SCAN', '8': 'PICKLIST',
  '9': 'CLONE JUMP', '10': 'SIGNATURE', '11': 'PHOTO', '12': 'CHECKLIST',
};

export default function QuestionsReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [category, setCategory] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getAllQuestions().then(setRows).finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => [...new Set(rows.map(q => q.category || '(Uncategorized)'))].sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const lc = search.trim().toLowerCase();
    return rows.filter(q =>
      (!category || (q.category || '(Uncategorized)') === category) &&
      (!typeFilter || q.question_type === typeFilter) &&
      (!lc || q.description.toLowerCase().includes(lc))
    );
  }, [rows, category, typeFilter, search]);

  const byCategory = useMemo(() => {
    const m = {};
    for (const q of filteredRows) {
      const cat = q.category || '(Uncategorized)';
      (m[cat] ??= []).push(q);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows]);

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const now = new Date().toLocaleString();

  function handleExport() {
    const headers = ['Category', 'Subcategory', 'Description', 'Type', 'Options / Mask', 'Default'];
    const rows = byCategory.flatMap(([cat, qs]) => qs.map(q => {
      const opts = [q.option1, q.option2, q.option3, q.option4, q.option5].filter(Boolean).join(' / ');
      return [cat, q.subcategory || '', q.description, TYPE_LABEL[q.question_type] ?? q.question_type ?? '', opts || q.mask || '', q.default_response || ''];
    }));
    downloadCsv('questions-setup', headers, rows);
  }

  return (
    <div className={styles.page}>
      <ReportHeader title="Questions Setup" subtitle="Full question library, grouped by category" backTo="/setup/reports" onExport={handleExport} />
      <div className={styles.meta}>Generated {now} — {filteredRows.length} of {rows.length} questions</div>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Category</label>
          <select className={styles.filterSelect} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Type</label>
          <select className={styles.filterSelect} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Search</label>
          <input className={styles.filterInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Description contains…" />
        </div>
      </div>

      {byCategory.map(([cat, qs]) => (
        <div className={styles.section} key={cat}>
          <h3 className={styles.sectionTitle}>
            {cat} <span className={styles.countBadge}>{qs.length}</span>
          </h3>
          <table className={styles.table}>
            <thead>
              <tr><th>Subcategory</th><th>Description</th><th>Type</th><th>Options / Mask</th><th>Default</th></tr>
            </thead>
            <tbody>
              {qs.map(q => {
                const opts = [q.option1, q.option2, q.option3, q.option4, q.option5].filter(Boolean).join(' / ');
                return (
                  <tr key={q.id}>
                    <td>{q.subcategory || '—'}</td>
                    <td>{q.description}</td>
                    <td>{TYPE_LABEL[q.question_type] ?? q.question_type ?? '—'}</td>
                    <td>{opts || q.mask || '—'}</td>
                    <td>{q.default_response || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <ReportFooter />
    </div>
  );
}
