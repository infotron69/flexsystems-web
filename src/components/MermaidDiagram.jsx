import { useEffect, useRef, useState } from 'react';
import styles from './MermaidDiagram.module.css';

// Mermaid (and its per-diagram-type sub-chunks) is a sizeable library only
// this one report actually uses -- a dynamic import keeps it out of the main
// app bundle entirely, fetched only when a flow chart is actually opened.
let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => {
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let renderCounter = 0;

// Opens the rendered SVG in a fresh tab and prints it there, rather than
// printing the current page -- the flow chart normally lives inside a Modal,
// and Modal.module.css sets `.overlay { display: none }` under @media print
// (so the modal doesn't get printed on top of whatever page opened it),
// which would otherwise make Ctrl+P/this button print nothing at all.
function printSvg(svg) {
  if (!svg) return;
  const win = window.open('', '_blank');
  if (!win) return;
  // Print the diagram at its own native size/aspect ratio (not the
  // shrink-to-fit scale it may currently be displayed at on screen) --
  // clone it so we don't carry over the on-screen size.
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  win.document.write(`<!doctype html><html><head><title>Flow Chart</title><style>
    @page { size: landscape; margin: 12mm; }
    html, body { margin: 0; padding: 0; }
    svg { width: 100%; height: auto; display: block; }
  </style></head><body>${clone.outerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch { /* user closed the tab before it fired */ } }, 300);
}

function naturalSize(svg) {
  const vb = svg.viewBox?.baseVal;
  return {
    w: vb?.width || svg.width.baseVal.value,
    h: vb?.height || svg.height.baseVal.value,
  };
}

// Standalone copy of the on-screen SVG (own size, white background) so it
// renders identically as a saved file, independent of the page around it.
function standaloneSvg(svg) {
  const { w, h } = naturalSize(svg);
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.insertAdjacentHTML('afterbegin', `<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>`);
  return { markup: new XMLSerializer().serializeToString(clone), w, h };
}

function download(href, name) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveSvg(svg, baseName) {
  if (!svg) return;
  const { markup } = standaloneSvg(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  download(url, `${baseName}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rasterised at 2x so it stays sharp when pasted into a document or printed.
// Very large charts are capped so the canvas stays within browser limits.
function savePng(svg, baseName, onError) {
  if (!svg) return;
  const { markup, w, h } = standaloneSvg(svg);
  const scale = Math.min(2, 8000 / Math.max(w, h));
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) { onError('Could not create the image.'); return; }
        const url = URL.createObjectURL(blob);
        download(url, `${baseName}.png`);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch {
      onError('The browser would not export this chart as a PNG -- use Save SVG instead.');
    }
  };
  img.onerror = () => onError('Could not create the image.');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

// Sizes the SVG by changing its own width/height (the viewBox scales it
// natively) rather than a CSS transform -- a transform leaves the unscaled
// layout box behind, which is what used to leave scrollbars and a cropped
// chart in "fit" mode.
//   fit    -- whole chart visible at once (both dimensions)
//   width  -- chart as wide as the window, scroll down for the rest
//   actual -- native size, scroll both ways
function applyFit(svg, stage, mode) {
  if (!svg || !stage) return;
  const { w, h } = naturalSize(svg);
  if (!w || !h) return;
  const availW = stage.clientWidth - 4;
  const availH = stage.clientHeight - 4;
  let scale = 1;
  if (mode === 'fit') scale = Math.min(availW / w, availH / h, 1);
  else if (mode === 'width') scale = Math.min((availW - 16) / w, 1);
  svg.style.maxWidth = 'none';
  svg.style.width = `${Math.floor(w * scale)}px`;
  svg.style.height = `${Math.floor(h * scale)}px`;
}

// Renders a Mermaid diagram definition to SVG client-side. `securityLevel:
// strict` (mermaid's own sanitizer) is the primary defense against the
// diagram text becoming live markup; sopFlowchart.js also HTML-escapes every
// label before it reaches this component, as a second layer.
export default function MermaidDiagram({ definition, fileName = 'flow-chart' }) {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loadingLib, setLoadingLib] = useState(true);
  const [mode, setMode] = useState('fit');
  const [renderTick, setRenderTick] = useState(0);
  const [exportErr, setExportErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    renderCounter += 1;
    const id = `sop-flow-${renderCounter}`;

    loadMermaid()
      .then(mermaid => {
        if (cancelled) return;
        setLoadingLib(false);
        return mermaid.render(id, definition);
      })
      .then(result => {
        if (!cancelled && result && containerRef.current) {
          containerRef.current.innerHTML = result.svg;
          setRenderTick(t => t + 1);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to render diagram');
      });

    return () => { cancelled = true; };
  }, [definition]);

  // Re-fit on mode change, new render, and whenever the window (so the
  // dialog) is resized.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const fitNow = () => applyFit(containerRef.current?.querySelector('svg'), stage, mode);
    fitNow();
    const ro = new ResizeObserver(fitNow);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [mode, renderTick, loadingLib]);

  if (error) return <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>Could not render flow chart: {error}</div>;
  if (loadingLib) return <div style={{ color: '#888', fontSize: '0.85rem' }}>Loading diagram…</div>;

  const svgEl = () => containerRef.current?.querySelector('svg');
  const baseName = (fileName || 'flow-chart').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          {[['fit', 'Fit to Window'], ['width', 'Fit Width'], ['actual', 'Actual Size']].map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={`${styles.toolBtn} ${mode === m ? styles.active : ''}`}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.group}>
          <button type="button" className={styles.toolBtn} onClick={() => { setExportErr(null); savePng(svgEl(), baseName, setExportErr); }}>
            🖼 Save Image (PNG)
          </button>
          <button type="button" className={styles.toolBtn} onClick={() => saveSvg(svgEl(), baseName)}>
            Save SVG
          </button>
          <button type="button" className={styles.toolBtn} onClick={() => printSvg(svgEl())}>
            🖶 Print
          </button>
        </div>
      </div>
      {exportErr && <div style={{ color: '#b91c1c', fontSize: '0.78rem', marginBottom: 6 }}>{exportErr}</div>}
      <div ref={stageRef} className={styles.stage}>
        <div ref={containerRef} className={styles.actual} />
      </div>
    </div>
  );
}
