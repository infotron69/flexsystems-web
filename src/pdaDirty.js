// Tiny module-level pub/sub, not React state -- setup pages that never
// re-render together need a single flag they can all flip from wherever
// their own save/delete handlers live, and Layout.jsx (which wraps every
// page) needs to observe it without every page importing a Context
// provider. Persists only for the tab's session; a reload naturally clears
// it, matching "did anything change since I opened the app" rather than
// tracking it forever.
let dirty = false;
const listeners = new Set();

export function markPdaFilesDirty() {
  if (dirty) return;
  dirty = true;
  listeners.forEach(l => l());
}

export function clearPdaFilesDirty() {
  if (!dirty) return;
  dirty = false;
  listeners.forEach(l => l());
}

export function isPdaFilesDirty() {
  return dirty;
}

export function subscribePdaFilesDirty(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
