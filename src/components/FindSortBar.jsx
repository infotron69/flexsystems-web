import styles from '../pages/Report.module.css';

// Find box + "Sort by" picker with an ascending/descending toggle, rendered
// as filter fields so it drops straight into a report's .filterBar (which
// is already hidden when printing).
export default function FindSortBar({
  find, onFind, placeholder = 'Find…',
  sortKey, onSortKey, sortDir, onSortDir, sortOptions,
}) {
  return (
    <>
      <div className={styles.filterField}>
        <label className={styles.filterLabel}>Find</label>
        <input
          className={styles.filterInput}
          type="search"
          value={find}
          onChange={e => onFind(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      {sortOptions?.length > 0 && (
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Sort by</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className={styles.filterSelect} value={sortKey} onChange={e => onSortKey(e.target.value)}>
              {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button
              type="button"
              className={styles.flowChartBtn}
              onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
            >
              {sortDir === 'asc' ? '▲ A–Z' : '▼ Z–A'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
