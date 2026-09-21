import { jumpLabels } from '../pages/pointQuestionsShared';

// Builds a deduplicated graph (not a tree -- two branches that both lead to
// the same question become two edges into ONE node) from a point's question
// list, following the same jump conventions as buildBranchTree in
// SopMaintReport.jsx. Terminal outcomes (Exit Point/Route, Log Incident,
// Repeat Scan) share one node each across the whole graph rather than one
// per occurrence, so the diagram doesn't balloon with duplicate endpoints.
const MAX_GRAPH_NODES = 100;

const TERMINAL_TEXT = {
  '0':  'Exit Point (checklist ends here)',
  '98': 'Log an Incident',
  '99': 'Exit Route (patrol ends here)',
  '97': 'Repeat Last Scan',
  '96': 'Repeat Last Scan + Photo',
};

// pointDescByCode is the same site-wide point_code -> description lookup the
// text view uses, for a point that's genuinely unreachable (no checklist at
// all, even after fetching) -- shows "Go to: <point name>" instead of a bare
// code. fetchList(pointCode) -- typically getRoutePointQuestions(SOP_ROUTE_ID,
// pointCode) -- is called on demand for any point not already present in
// questionsByPoint, so the diagram can follow a jump chain past whatever
// happened to be bulk-loaded up front, all the way to a real terminal step.
// Returns fetchedPoints (a Map) alongside the graph so the caller can merge
// newly-discovered points back into its own cache for next time.
export async function buildFlowGraph(rootRpq, rootList, questionsByPoint, pointDescByCode = {}, fetchList) {
  const cache = new Map(Object.entries(questionsByPoint));
  const fetchedPoints = new Map();
  const nodes = new Map(); // id -> { id, label, kind, required }
  const edges = []; // { from, to, label }
  const terminalIds = {};

  function terminalNode(text) {
    if (!terminalIds[text]) {
      const id = `t${Object.keys(terminalIds).length}`;
      terminalIds[text] = id;
      nodes.set(id, { id, label: text, kind: 'terminal' });
    }
    return terminalIds[text];
  }

  function questionNode(rpq) {
    const id = `q${rpq.id}`;
    // Define on first reference (not just when dequeued) so an edge never
    // points at an ID Mermaid has never seen a label for -- if traversal
    // gets capped before this node is expanded, it still renders correctly,
    // just as a dead end with no outgoing edges of its own.
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: rpq.question?.description ?? '—', kind: 'question', required: rpq.answer_required === 'Y' });
    }
    return id;
  }

  async function resolvePointList(pointCode) {
    if (cache.has(pointCode)) return cache.get(pointCode);
    let qs = [];
    if (fetchList) {
      try { qs = await fetchList(pointCode); } catch { qs = []; }
    }
    cache.set(pointCode, qs);
    fetchedPoints.set(pointCode, qs);
    return qs;
  }

  const seen = new Set();
  questionNode(rootRpq);
  const queue = [{ rpq: rootRpq, list: rootList }];

  while (queue.length && seen.size < MAX_GRAPH_NODES) {
    const { rpq, list } = queue.shift();
    const id = questionNode(rpq);
    if (seen.has(id)) continue;
    seen.add(id);

    const labels = jumpLabels(rpq.question);
    const jumps = [rpq.jump1, rpq.jump2, rpq.jump3, rpq.jump4, rpq.jump5];

    for (let i = 0; i < 5; i++) {
      const label = labels[i];
      const raw = jumps[i];
      if (label === null || !raw || raw === '') continue;
      const v = raw.trim();

      if (TERMINAL_TEXT[v]) {
        edges.push({ from: id, to: terminalNode(TERMINAL_TEXT[v]), label });
        continue;
      }

      let target, targetList;
      if (/^\d{1,4}$/.test(v)) {
        target = list[parseInt(v, 10) - 1];
        targetList = list;
      } else {
        targetList = await resolvePointList(v);
        target = targetList[0];
      }

      if (!target) {
        const text = pointDescByCode[v] ? `Go to: ${pointDescByCode[v]}` : `Go to: ${v}`;
        edges.push({ from: id, to: terminalNode(text), label });
        continue;
      }

      const tid = questionNode(target);
      edges.push({ from: id, to: tid, label });
      if (!seen.has(tid) && seen.size < MAX_GRAPH_NODES) {
        queue.push({ rpq: target, list: targetList });
      }
    }
  }

  return { nodes: [...nodes.values()], edges, truncated: seen.size >= MAX_GRAPH_NODES, fetchedPoints };
}

// Keeps node/edge labels from breaking out of Mermaid's quoted node-text
// syntax or injecting markup once the rendered SVG lands in the DOM.
function mermaidText(s, maxLen = 60) {
  const trimmed = String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  const truncated = trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + '…' : trimmed;
  return truncated
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function graphToMermaid(graph) {
  const lines = ['flowchart TD'];
  for (const n of graph.nodes) {
    const text = mermaidText(n.label) + (n.required ? ' *' : '');
    if (n.kind === 'terminal') {
      lines.push(`  ${n.id}(["${text}"])`);
      lines.push(`  class ${n.id} terminalNode;`);
    } else {
      lines.push(`  ${n.id}["${text}"]`);
    }
  }
  for (const e of graph.edges) {
    lines.push(`  ${e.from} -->|"${mermaidText(e.label, 30)}"| ${e.to}`);
  }
  lines.push('  classDef terminalNode fill:#fef3c7,stroke:#d97706,color:#7a4a00;');
  if (graph.truncated) {
    lines.push('  trunc["… diagram truncated (too many steps)"]');
  }
  return lines.join('\n');
}
