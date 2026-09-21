// Client-side CSV export -- no backend call, no new dependency. Opens
// directly in Excel; not a "real" .xlsx (single sheet, no formatting), but
// covers every Configuration Report, all of which are flat/tabular.

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// headers: string[]; rows: array of arrays (same length/order as headers)
export function downloadCsv(filename, headers, rows) {
  // Leading BOM so Excel (Windows) detects UTF-8 instead of guessing ANSI.
  const lines = [headers, ...rows].map(row => row.map(escapeCell).join(','));
  const csv = '﻿' + lines.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
