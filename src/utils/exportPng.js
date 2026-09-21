// Client-side PNG export via html2canvas -- snapshots a DOM node and
// downloads it, mirroring exportCsv.js's blob/anchor pattern. Reuses the
// same approach already proven in PdaEmulator.jsx's takeScreenshot().
import html2canvas from 'html2canvas';

export async function downloadPng(element, filename, options = {}) {
  if (!element) return;
  // useCORS: true -- without it, cross-origin images (e.g. GpsMapView's
  // OpenStreetMap tiles) taint the canvas and render as blank rectangles
  // instead of throwing, so the omission is silent.
  const canvas = await html2canvas(element, { backgroundColor: '#ffffff', scale: 2, useCORS: true, ...options });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
