import { useState } from 'react';

// Shared Find + Sort state for the Setup report screens (see FindSortBar).
export function useFindSort(defaultKey, defaultDir = 'asc') {
  const [find, setFind] = useState('');
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  return { find, setFind, sortKey, setSortKey, sortDir, setSortDir };
}

// True when `find` is empty, or any value contains it (case-insensitive).
export function matchesFind(find, ...values) {
  const q = (find || '').trim().toLowerCase();
  if (!q) return true;
  return values.some(v => v != null && String(v).toLowerCase().includes(q));
}

// Numbers compare numerically, everything else as natural-order text so
// "P2" sorts before "P10" and blanks sort together.
export function compareValues(a, b, dir = 'asc') {
  let c;
  if (typeof a === 'number' && typeof b === 'number') c = a - b;
  else c = String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? c : -c;
}

// Filters then sorts a list. `alwaysKeep` skips the filter -- used when a
// parent already matched (a route whose own name matched keeps all its
// points), so the sort still applies but nothing is hidden.
export function findAndSort(items, view, searchFields, sortValue, alwaysKeep = false) {
  const rows = alwaysKeep ? items : items.filter(it => matchesFind(view.find, ...searchFields(it)));
  return [...rows].sort((a, b) => compareValues(sortValue(a, view.sortKey), sortValue(b, view.sortKey), view.sortDir));
}
