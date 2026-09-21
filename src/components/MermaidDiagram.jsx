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
  // clone it so we don't carry over the on-screen transform/inline size.
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

// A checklist with many sequential questions produces a tall top-down
// flowchart -- shrinking only its width (e.g. CSS max-width:100%) barely
// helps since height follows the aspect ratio, so "fit" here scales the
// whole SVG by whichever of width/height is more constrained, same idea as
// a PDF viewer's "fit page" rather than "fit width".
function applyFit(svg, container, fit) {
  if (!svg || !container) return;
  if (!fit) {
    svg.style.transform = '';
    svg.style.width = '';
    svg.style.height = '';
    container.style.width = '';
    container.style.height = '';
    return;
  }
  const naturalWidth = svg.viewBox?.baseVal?.width || svg.width.baseVal.value;
  const naturalHeight = svg.viewBox?.baseVal?.height || svg.height.baseVal.value;
  if (!naturalWidth || !naturalHeight) return;
  const availWidth = container.parentElement.clientWidth;
  const availHeight = Math.max(300, window.innerHeight * 0.6);
  const scale = Math.min(availWidth / naturalWidth, availHeight / naturalHeight, 1);
  svg.style.width = `${naturalWidth}px`;
  svg.style.height = `${naturalHeight}px`;
  svg.style.transform = `scale(${scale})`;
  svg.style.transformOrigin = 'top left';
  container.style.width = `${naturalWidth * scale}px`;
  container.style.height = `${naturalHeight * scale}px`;
}

// Renders a Mermaid diagram definition to SVG client-side. `securityLevel:
// strict` (mermaid's own sanitizer) is the primary defense against the
// diagram text becoming live markup; sopFlowchart.js also HTML-escapes every
// label before it reaches this component, as a second layer.
export default function MermaidDiagram({ definition }) {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loadingLib, setLoadingLib] = useState(true);
  const [fit, setFit] = useState(true);
  const [renderTick, setRenderTick] = useState(0);

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

  useEffect(() => {
    applyFit(containerRef.current?.querySelector('svg'), containerRef.current, fit);
  }, [fit, renderTick]);

  if (error) return <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>Could not render flow chart: {error}</div>;
  if (loadingLib) return <div style={{ color: '#888', fontSize: '0.85rem' }}>Loading diagram…</div>;

  return (
    <div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolBtn} onClick={() => setFit(f => !f)}>
          {fit ? '🔍 Actual Size' : '⤢ Fit to Window'}
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => printSvg(containerRef.current?.querySelector('svg'))}
        >
          🖶 Print
        </button>
      </div>
      <div ref={stageRef} className={styles.stage}>
        <div ref={containerRef} className={styles.actual} />
      </div>
    </div>
  );
}
