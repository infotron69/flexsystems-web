import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import useScrollRestoration from '../hooks/useScrollRestoration';
import {
  getSite, getCustomer,
  getRoutes, createRoute, updateRoute, deleteRoute, nextRouteCode,
  getPoints, createPoint, nextPointCode,
  getRoutePoints, addPointToRoute, removePointFromRoute, updateRoutePoint, getRoutePointQuestionCounts,
  copyRoutePointsAndQuestions,
} from '../api/client';
import Breadcrumb from '../components/Breadcrumb';
import BackButton from '../components/BackButton';
import useCanEditSite from '../hooks/useCanEditSite';
import { markPdaFilesDirty } from '../pdaDirty';
import styles from './RouteSetup.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nextCode(prefix, existing, field, padLen = 4) {
  const nums = existing
    .map(r => r[field])
    .filter(c => c && c.startsWith(prefix))
    .map(c => parseInt(c.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return prefix + String(max + 1).padStart(padLen, '0');
}

// Points on the special "Incidents1" site (SOP/clone jump destinations) follow
// a "C" + 9-digit code convention in the real data (e.g. C000000063).
const SOP_SITE_ID = 'Incidents1';
const SOP_POINT_PREFIX = 'C';

// ─────────────────────────────────────────────────────────────────────────────
// RouteSetup — always reached scoped to a site (Customers > Sites > here).
// Owns route create/edit/delete and point add/remove for that site's routes.
// ─────────────────────────────────────────────────────────────────────────────
export default function RouteSetup() {
  const { siteId } = useParams();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { canEdit } = useCanEditSite();
  const editable = canEdit(siteId, 'routes');

  // ── site/customer context (for breadcrumb) ──────────────────────────────────
  const [site,     setSite]     = useState(null);
  const [customer, setCustomer] = useState(null);

  // ── master data (this site only) ─────────────────────────────────────────────
  const [routes, setRoutes] = useState([]);
  const [sortMode, setSortMode] = useState('name'); // 'name' | 'code'
  const [pointSortMode, setPointSortMode] = useState('code'); // 'code' | 'description'
  const [filterCategory, setFilterCategory] = useState(''); // narrows both point-picker lists below
  const [filterSubCategory, setFilterSubCategory] = useState('');

  // ── selected route ─────────────────────────────────────────────────────────
  const [selRoute,    setSelRoute]    = useState(null);   // full route object
  const [allocPoints, setAllocPoints] = useState([]);     // RoutePointSetup[]
  const [sitePoints,  setSitePoints]  = useState([]);     // all Point[] for site
  const [questionCounts, setQuestionCounts] = useState({}); // point_id -> question count on this route

  // ── route form ─────────────────────────────────────────────────────────────
  const [formName,     setFormName]     = useState('');
  const [formCode,     setFormCode]     = useState('');
  const [formTemplate, setFormTemplate] = useState(false);
  const [formRequiresOos, setFormRequiresOos] = useState(false);
  const [formSaving,   setFormSaving]   = useState(false);
  const [formErr,      setFormErr]      = useState(null);
  const [isNew,        setIsNew]        = useState(false);

  // ── point listboxes (multi-select: click=replace, ctrl/cmd=toggle, shift=range) ──
  const [selAvail,    setSelAvail]    = useState(() => new Set()); // selected available point ids
  const [availAnchor, setAvailAnchor] = useState(null);            // last-clicked index, for shift-range
  const [selAlloc,    setSelAlloc]    = useState(() => new Set()); // selected allocated point ids
  const [allocAnchor, setAllocAnchor] = useState(null);
  const [oosSaving,   setOosSaving]   = useState(false); // per-point Out-of-Service override, single-select only

  // ── new point form ─────────────────────────────────────────────────────────
  // tag_type isn't collected here -- every point in the real data is a
  // barcode tag ("B"), which is also the backend's default, so the field
  // stays hidden rather than inviting a value that's never actually used.
  const [addingPoint,   setAddingPoint]   = useState(false);
  const [newPointCode,  setNewPointCode]  = useState('');
  const [newPointDesc,  setNewPointDesc]  = useState('');
  const [newPointLocation, setNewPointLocation] = useState('');
  const [newPointCategory, setNewPointCategory] = useState('');
  const [newPointSubCategory, setNewPointSubCategory] = useState('');
  const [newPointNotes, setNewPointNotes] = useState(['', '', '', '', '']);
  const [newPointSaving, setNewPointSaving] = useState(false);
  const [newPointErr,   setNewPointErr]   = useState(null);

  // ── copy points/questions from another route ─────────────────────────────
  const [copySourceId, setCopySourceId] = useState('');
  const [copying,      setCopying]      = useState(false);

  const [loading, setLoading] = useState(true);

  // ── Scroll restoration (own list boxes, independent of <main>'s) ────────────
  const routeListRef = useRef(null);
  const availListRef = useRef(null);
  const allocListRef = useRef(null);
  useScrollRestoration(routeListRef, 'routes');
  useScrollRestoration(availListRef, 'avail');
  useScrollRestoration(allocListRef, 'alloc');

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    getSite(siteId).then(s => {
      setSite(s);
      return Promise.all([
        getCustomer(s.customer_id),
        getRoutes({ site_id: siteId }),
        getPoints({ site_id: siteId }),
      ]);
    }).then(([cust, r, pts]) => {
      setCustomer(cust);
      setRoutes(r);
      setSitePoints(pts);
    }).finally(() => setLoading(false));
  }, [siteId]);

  // Restore selected route from navigation state (e.g. back from questions page)
  useEffect(() => {
    if (location.state?.routeId && routes.length) {
      const r = routes.find(r => r.id === location.state.routeId);
      if (r) selectRoute(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  // ── Select a route ──────────────────────────────────────────────────────────
  const selectRoute = useCallback(async (route) => {
    setSelRoute(route);
    setIsNew(false);
    setFormName(route.name);
    setFormCode(route.route_code);
    setFormTemplate(route.is_template ?? false);
    setFormRequiresOos(route.requires_oos ?? false);
    setFormErr(null);
    setSelAvail(new Set());
    setAvailAnchor(null);
    setSelAlloc(new Set());
    setAllocAnchor(null);

    const [alloc, counts] = await Promise.all([
      getRoutePoints(route.id),
      getRoutePointQuestionCounts(route.id).catch(() => ({})),
    ]);
    setAllocPoints(alloc);
    setQuestionCounts(counts);
  }, []);

  const sortedRoutes = useMemo(() => {
    if (sortMode === 'code') {
      return [...routes].sort((a, b) => a.route_code.localeCompare(b.route_code));
    }
    return [...routes].sort((a, b) => a.name.localeCompare(b.name));
  }, [routes, sortMode]);

  // ── Available points = site points minus already allocated ──────────────────
  const allocatedIds = new Set(allocPoints.map(ap => ap.point_id));
  const availPoints  = sitePoints.filter(p => !allocatedIds.has(p.id));

  // Category filter options come from every point on the site (not just the
  // currently-visible list) so switching Category doesn't also reset itself;
  // Sub-Category narrows to what actually co-occurs with the chosen Category.
  const categoryOptions = useMemo(
    () => [...new Set(sitePoints.map(p => p.category).filter(Boolean))].sort(),
    [sitePoints]
  );
  const subCategoryOptions = useMemo(
    () => [...new Set(
      sitePoints
        .filter(p => !filterCategory || p.category === filterCategory)
        .map(p => p.sub_category)
        .filter(Boolean)
    )].sort(),
    [sitePoints, filterCategory]
  );

  function matchesCategoryFilter(point) {
    if (!point) return false;
    if (filterCategory && point.category !== filterCategory) return false;
    if (filterSubCategory && point.sub_category !== filterSubCategory) return false;
    return true;
  }

  // Both point lists share one sort control -- Code or Description -- and the
  // sorted arrays (not the raw ones) drive both rendering and shift/ctrl-click
  // range selection, so an item's on-screen position always matches its index.
  const sortedAvailPoints = useMemo(() => {
    const arr = availPoints.filter(matchesCategoryFilter);
    arr.sort((a, b) => pointSortMode === 'description'
      ? a.description.localeCompare(b.description)
      : a.point_code.localeCompare(b.point_code));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitePoints, allocPoints, pointSortMode, filterCategory, filterSubCategory]);

  const sortedAllocPoints = useMemo(() => {
    const arr = allocPoints.filter(ap => matchesCategoryFilter(ap.point));
    arr.sort((a, b) => pointSortMode === 'description'
      ? (a.point?.description ?? '').localeCompare(b.point?.description ?? '')
      : (a.point?.point_code ?? '').localeCompare(b.point?.point_code ?? ''));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocPoints, pointSortMode, filterCategory, filterSubCategory]);

  // ── Route form save ─────────────────────────────────────────────────────────
  async function saveRoute() {
    setFormSaving(true);
    setFormErr(null);
    try {
      const body = {
        name:        formName.trim().toUpperCase(),
        route_code:  formCode.trim().toUpperCase(),
        site_id:     siteId,
        is_template: formTemplate,
        requires_oos: formRequiresOos,
      };
      if (isNew) {
        const created = await createRoute(body);
        const all = await getRoutes({ site_id: siteId });
        setRoutes(all);
        await selectRoute(created);
      } else {
        const updated = await updateRoute(selRoute.id, body);
        setRoutes(prev => prev.map(r => r.id === updated.id ? updated : r));
        setSelRoute(updated);
      }
      setIsNew(false);
      markPdaFilesDirty();
    } catch (ex) {
      setFormErr(ex.response?.data?.detail ?? 'Save failed');
    } finally {
      setFormSaving(false);
    }
  }

  async function deleteRouteAction() {
    if (!selRoute) return;
    if (!confirm(`Delete route "${selRoute.name}"? This will also remove all point and question assignments.`)) return;
    try {
      await deleteRoute(selRoute.id);
      setRoutes(prev => prev.filter(r => r.id !== selRoute.id));
      setSelRoute(null);
      setAllocPoints([]);
      setIsNew(false);
      markPdaFilesDirty();
    } catch (ex) {
      setFormErr(ex.response?.data?.detail ?? 'Delete failed');
    }
  }

  function startNewRoute() {
    setSelRoute(null);
    setIsNew(true);
    setFormName('');
    setFormCode('');
    // Next ID in the 10-digit sequence, still editable afterward.
    nextRouteCode().then(code => setFormCode(prev => prev || code)).catch(() => {});
    setFormTemplate(false);
    setFormRequiresOos(false);
    setFormErr(null);
    setAllocPoints([]);
    setSelAvail(new Set());
    setAvailAnchor(null);
    setSelAlloc(new Set());
    setAllocAnchor(null);
  }

  // ── Multi-select click handling ─────────────────────────────────────────────
  // Plain click = replace selection; ctrl/cmd+click = toggle one; shift+click =
  // range from the last plain/ctrl click to here (standard listbox behavior).
  function clickSelect(id, index, e, selected, setSelected, anchor, setAnchor, items) {
    if (e.shiftKey && anchor != null) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(items.slice(lo, hi + 1).map(it => it.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      setAnchor(index);
    } else {
      setSelected(new Set([id]));
      setAnchor(index);
    }
  }

  function clickAvail(p, index, e) {
    clickSelect(p.id, index, e, selAvail, setSelAvail, availAnchor, setAvailAnchor, sortedAvailPoints);
    setSelAlloc(new Set());
    setAllocAnchor(null);
  }

  function clickAlloc(ap, index, e) {
    clickSelect(ap.point_id, index, e, selAlloc, setSelAlloc, allocAnchor, setAllocAnchor,
      sortedAllocPoints.map(a => ({ id: a.point_id })));
    setSelAvail(new Set());
    setAvailAnchor(null);
  }

  // ── Add / remove points ─────────────────────────────────────────────────────
  async function addPoint() {
    if (selAvail.size === 0 || !selRoute) return;
    try {
      await Promise.all(
        [...selAvail].map(pointId => addPointToRoute(selRoute.id, { route_id: selRoute.id, point_id: pointId }))
      );
      const alloc = await getRoutePoints(selRoute.id);
      setAllocPoints(alloc);
      setSelAvail(new Set());
      setAvailAnchor(null);
      markPdaFilesDirty();
    } catch (ex) {
      alert('Add failed: ' + (ex.response?.data?.detail ?? ex.message));
    }
  }

  async function removePoint() {
    if (selAlloc.size === 0 || !selRoute) return;
    try {
      await Promise.all([...selAlloc].map(pointId => removePointFromRoute(selRoute.id, pointId)));
      setAllocPoints(prev => prev.filter(ap => !selAlloc.has(ap.point_id)));
      setSelAlloc(new Set());
      setAllocAnchor(null);
      markPdaFilesDirty();
    } catch (ex) {
      alert('Remove failed: ' + (ex.response?.data?.detail ?? ex.message));
    }
  }

  // value: null (inherit the route's own default), true, or false --
  // overrides Requires_OOS for just this one point on this one route.
  async function setPointOosOverride(pointId, value) {
    if (!selRoute) return;
    setOosSaving(true);
    try {
      const updated = await updateRoutePoint(selRoute.id, pointId, { requires_oos: value });
      setAllocPoints(prev => prev.map(ap => ap.point_id === pointId ? { ...ap, requires_oos: updated.requires_oos } : ap));
      markPdaFilesDirty();
    } catch (ex) {
      alert('Could not update Out-of-Service setting: ' + (ex.response?.data?.detail ?? ex.message));
    } finally {
      setOosSaving(false);
    }
  }

  // ── New point ────────────────────────────────────────────────────────────────
  function startNewPoint() {
    setAddingPoint(true);
    if (siteId === SOP_SITE_ID) {
      setNewPointCode(nextCode(SOP_POINT_PREFIX, sitePoints, 'point_code', 9));
    } else {
      // Matches ImportPoints.jsx's "Add Point" form: point codes are a
      // site-scoped numeric sequence, not derived from the description, so
      // one fetch on open is enough -- still editable afterward if the
      // admin wants to override it.
      setNewPointCode('');
      nextPointCode(siteId).then(setNewPointCode).catch(() => {});
    }
    setNewPointDesc('');
    setNewPointLocation('');
    setNewPointCategory('');
    setNewPointSubCategory('');
    setNewPointNotes(['', '', '', '', '']);
    setNewPointErr(null);
  }

  function cancelNewPoint() {
    setAddingPoint(false);
    setNewPointErr(null);
  }

  function setNewPointNote(i, value) {
    setNewPointNotes(prev => prev.map((n, idx) => idx === i ? value : n));
  }

  async function saveNewPoint() {
    setNewPointSaving(true);
    setNewPointErr(null);
    try {
      const created = await createPoint({
        point_code:  newPointCode.trim().toUpperCase(),
        description: newPointDesc.trim().toUpperCase(),
        site_id:     siteId,
        location:    newPointLocation.trim().toUpperCase() || null,
        category:     newPointCategory.trim().toUpperCase() || null,
        sub_category: newPointSubCategory.trim().toUpperCase() || null,
        notes1:      newPointNotes[0].trim().toUpperCase() || null,
        notes2:      newPointNotes[1].trim().toUpperCase() || null,
        notes3:      newPointNotes[2].trim().toUpperCase() || null,
        notes4:      newPointNotes[3].trim().toUpperCase() || null,
        notes5:      newPointNotes[4].trim().toUpperCase() || null,
      });
      setSitePoints(prev => [...prev, created]);
      setAddingPoint(false);
      markPdaFilesDirty();
    } catch (ex) {
      setNewPointErr(ex.response?.data?.detail ?? 'Create failed');
    } finally {
      setNewPointSaving(false);
    }
  }

  // ── Copy points/questions from another route on this site ──────────────────
  async function copyFromRoute() {
    if (!copySourceId || !selRoute) return;
    const source = routes.find(r => r.id === copySourceId);
    if (!confirm(
      `Copy all points and questions from "${source?.name}" onto "${selRoute.name}"?\n\n` +
      `Points already on this route are left as-is -- only points not already here are added.`
    )) return;
    setCopying(true);
    try {
      const result = await copyRoutePointsAndQuestions(selRoute.id, copySourceId);
      const [alloc, counts] = await Promise.all([
        getRoutePoints(selRoute.id),
        getRoutePointQuestionCounts(selRoute.id).catch(() => ({})),
      ]);
      setAllocPoints(alloc);
      setQuestionCounts(counts);
      setCopySourceId('');
      markPdaFilesDirty();
      alert(
        `Copied ${result.points_copied} point(s) and ${result.questions_copied} question(s) from "${source?.name}".` +
        (result.points_skipped ? ` ${result.points_skipped} point(s) already on this route were skipped.` : '')
      );
    } catch (ex) {
      alert('Copy failed: ' + (ex.response?.data?.detail ?? ex.message));
    } finally {
      setCopying(false);
    }
  }

  // ── Navigate to questions ───────────────────────────────────────────────────
  function openQuestions(pointId) {
    if (!selRoute) return;
    navigate(
      `/setup/routes/${selRoute.id}/points/${pointId}/questions`,
      { state: { siteId, routeId: selRoute.id } }
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  const crumbs = [
    { label: 'Customers', to: '/setup/customers' },
    { label: customer?.name ?? '…', to: `/setup/customers/${customer?.id}/sites` },
    { label: site?.name ?? '…' },
  ];

  return (
    <>
    {/* Parent is this site's customer, only known once loaded -- so this
        screen renders the standard BackButton itself (see navigation.js). */}
    {customer?.id && <BackButton to={`/setup/customers/${customer.id}/sites`} label="Sites" />}
    <div className={styles.page}>
      <Breadcrumb crumbs={crumbs} />
      <div className={styles.header}>
        <h2 className={styles.heading}>
          Routes — {site?.name}
          {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
        </h2>
        <button
          className={styles.questionsBtn}
          style={{ marginLeft: 'auto', marginTop: 0, alignSelf: 'center' }}
          onClick={() => navigate('/setup/points/import')}
        >
          Edit Points →
        </button>
        <button
          className={styles.questionsBtn}
          style={{ marginTop: 0, alignSelf: 'center' }}
          onClick={() => navigate('/setup/reports/routes')}
        >
          Print Report →
        </button>
      </div>

      <div className={styles.shell}>

        {/* ── Left: route list ── */}
        <div className={styles.routeList}>
          <div className={styles.listHeader}>
            Routes
            <div className={styles.sortRow}>
              <span className={styles.sortLabel}>Sort by</span>
              <select
                className={styles.sortSelect}
                value={sortMode}
                onChange={e => setSortMode(e.target.value)}
              >
                <option value="name">Name</option>
                <option value="code">Route Code</option>
              </select>
            </div>
          </div>
          <div className={styles.listBox} ref={routeListRef}>
            {sortedRoutes.map(r => (
              <div
                key={r.id}
                className={`${styles.listItem} ${selRoute?.id === r.id ? styles.selected : ''}`}
                onClick={() => selectRoute(r)}
              >
                <span className={styles.routeName}>{r.name}</span>
                <span className={styles.routeSite}>{r.route_code}</span>
              </div>
            ))}
            {routes.length === 0 && (
              <div className={styles.empty}>No routes for this site</div>
            )}
          </div>
          <button className={styles.newRouteBtn} onClick={startNewRoute} disabled={!editable}>
            + New Route
          </button>
        </div>

        {/* ── Right: route detail + points ── */}
        <div className={styles.detail}>

          {/* Route form */}
          {(selRoute || isNew) ? (
            <div className={styles.routeForm}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Route Name</label>
                <input
                  className={styles.formInput}
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Route name"
                  maxLength={20}
                  disabled={!editable}
                />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Route Code</label>
                <input
                  className={`${styles.formInput} ${styles.codeInput}`}
                  value={formCode}
                  onChange={e => setFormCode(e.target.value)}
                  placeholder="Code"
                  maxLength={10}
                  disabled={!editable}
                />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Site</label>
                <div className={styles.formStatic}>{site?.name}</div>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Template</label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={formTemplate}
                    onChange={e => setFormTemplate(e.target.checked)}
                    disabled={!editable}
                  />
                  Template route (not sent to PDA)
                </label>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Out-of-Service (route default)</label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={formRequiresOos}
                    onChange={e => setFormRequiresOos(e.target.checked)}
                    disabled={!editable}
                  />
                  Require confirmation that a failed item was removed from service
                </label>
                <span className={styles.formHint}>
                  Applies to every point on this route unless overridden for a specific point below.
                </span>
              </div>
              {formErr && <div className={styles.formErr}>{formErr}</div>}
              <div className={styles.formActions}>
                {editable && (
                  <button
                    className={styles.saveBtn}
                    onClick={saveRoute}
                    disabled={formSaving || !formName.trim() || !formCode.trim()}
                  >
                    {formSaving ? '…' : isNew ? 'Add' : 'Update'}
                  </button>
                )}
                {!isNew && selRoute && editable && (
                  <button className={styles.deleteBtn} onClick={deleteRouteAction}>
                    Delete
                  </button>
                )}
                {isNew && (
                  <button
                    className={styles.cancelBtn}
                    onClick={() => { setIsNew(false); setSelRoute(null); }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.noSelection}>
              Select a route from the list, or click <strong>+ New Route</strong>
            </div>
          )}

          {/* Points section (only when an existing route is selected) */}
          {selRoute && !isNew && (
            <div className={styles.pointsSection}>
              <div className={styles.pointsHeader}>
                <span>Points — {selRoute.name}</span>
                {editable && (
                  <div className={styles.sortRow}>
                    <span className={styles.sortLabel}>Copy From</span>
                    <select
                      className={styles.sortSelect}
                      value={copySourceId}
                      onChange={e => setCopySourceId(e.target.value)}
                      disabled={copying}
                    >
                      <option value="">Select a route…</option>
                      {routes.filter(r => r.id !== selRoute.id).map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <button
                      className={styles.newPointBtn}
                      onClick={copyFromRoute}
                      disabled={!copySourceId || copying}
                      title="Copy points and questions from the selected route onto this one"
                    >
                      {copying ? '…' : 'Copy Points & Questions'}
                    </button>
                  </div>
                )}
                <div className={styles.sortRow}>
                  <span className={styles.sortLabel}>Category</span>
                  <select
                    className={styles.sortSelect}
                    value={filterCategory}
                    onChange={e => { setFilterCategory(e.target.value); setFilterSubCategory(''); }}
                  >
                    <option value="">All</option>
                    {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className={styles.sortLabel}>Sub-Category</span>
                  <select
                    className={styles.sortSelect}
                    value={filterSubCategory}
                    onChange={e => setFilterSubCategory(e.target.value)}
                    disabled={subCategoryOptions.length === 0}
                  >
                    <option value="">All</option>
                    {subCategoryOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                  </select>
                  <span className={styles.sortLabel}>Sort by</span>
                  <select
                    className={styles.sortSelect}
                    value={pointSortMode}
                    onChange={e => setPointSortMode(e.target.value)}
                  >
                    <option value="code">Point Code</option>
                    <option value="description">Description</option>
                  </select>
                </div>
              </div>

              <div className={styles.dualBox}>

                {/* Available */}
                <div className={styles.boxCol}>
                  <div className={styles.boxLabel}>
                    <span>
                      Points Available for Site
                      <span className={styles.multiHint}> (shift/ctrl+click for multiple)</span>
                      {selAvail.size > 1 && <span className={styles.selCount}> — {selAvail.size} selected</span>}
                    </span>
                    {editable && (
                      <button className={styles.newPointBtn} onClick={startNewPoint}>
                        + New Point
                      </button>
                    )}
                  </div>

                  {addingPoint && (
                    <div className={styles.newPointForm}>
                      <input
                        className={styles.newPointInput}
                        value={newPointCode}
                        onChange={e => setNewPointCode(e.target.value)}
                        placeholder="auto-generated"
                        maxLength={10}
                      />
                      <input
                        className={styles.newPointInput}
                        value={newPointDesc}
                        onChange={e => setNewPointDesc(e.target.value)}
                        placeholder="Description"
                        maxLength={60}
                      />
                      <input
                        className={styles.newPointInput}
                        value={newPointLocation}
                        onChange={e => setNewPointLocation(e.target.value)}
                        placeholder="Location"
                      />
                      <input
                        className={styles.newPointInput}
                        value={newPointCategory}
                        onChange={e => setNewPointCategory(e.target.value)}
                        placeholder="Category"
                        maxLength={50}
                      />
                      <input
                        className={styles.newPointInput}
                        value={newPointSubCategory}
                        onChange={e => setNewPointSubCategory(e.target.value)}
                        placeholder="Sub-Category"
                        maxLength={50}
                      />
                      {newPointNotes.map((note, i) => (
                        <input
                          key={i}
                          className={styles.newPointInput}
                          value={note}
                          onChange={e => setNewPointNote(i, e.target.value)}
                          placeholder={`PDA Note ${i + 1}`}
                          maxLength={24}
                        />
                      ))}
                      {newPointErr && <div className={styles.formErr}>{newPointErr}</div>}
                      <div className={styles.newPointActions}>
                        <button
                          className={styles.saveBtn}
                          onClick={saveNewPoint}
                          disabled={newPointSaving || !newPointCode.trim() || !newPointDesc.trim()}
                        >
                          {newPointSaving ? '…' : 'Add'}
                        </button>
                        <button className={styles.cancelBtn} onClick={cancelNewPoint}>Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className={styles.listBox} ref={availListRef}>
                    {sortedAvailPoints.map((p, i) => (
                      <div
                        key={p.id}
                        className={`${styles.listItem} ${selAvail.has(p.id) ? styles.selected : ''}`}
                        onClick={e => clickAvail(p, i, e)}
                      >
                        <span className={styles.pointCode}>{p.point_code}</span>
                        <span className={styles.pointDesc}>{p.description}</span>
                      </div>
                    ))}
                    {availPoints.length === 0 && (
                      <div className={styles.empty}>
                        {sitePoints.length === 0 ? 'No points for this site' : 'All points allocated'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Transfer buttons */}
                <div className={styles.transferBtns}>
                  <button
                    className={styles.transferBtn}
                    onClick={addPoint}
                    disabled={selAvail.size === 0 || !editable}
                    title="Add to route"
                  >
                    &gt;&gt;&gt;
                  </button>
                  <button
                    className={styles.transferBtn}
                    onClick={removePoint}
                    disabled={selAlloc.size === 0 || !editable}
                    title="Remove from route"
                  >
                    &lt;&lt;&lt;
                  </button>
                </div>

                {/* Allocated */}
                <div className={styles.boxCol}>
                  <div className={styles.boxLabel}>
                    <span>
                      Points Allocated for Route
                      <span className={styles.countBadge}> ({allocPoints.length})</span>
                    </span>
                    {selAlloc.size > 1 && <span className={styles.selCount}> — {selAlloc.size} selected</span>}
                  </div>
                  <div className={styles.listBox} ref={allocListRef}>
                    {sortedAllocPoints.map((ap, i) => {
                      const hasOverride = ap.requires_oos !== null && ap.requires_oos !== undefined;
                      // Effective value shown/checked: this point's own
                      // override if it has one, else the route's default.
                      const effectiveOos = hasOverride ? ap.requires_oos : formRequiresOos;
                      return (
                        <div
                          key={ap.point_id}
                          className={`${styles.listItem} ${selAlloc.has(ap.point_id) ? styles.selected : ''}`}
                          onClick={e => clickAlloc(ap, i, e)}
                          onDoubleClick={() => openQuestions(ap.point_id)}
                          title="Double-click to open questions"
                        >
                          <span className={styles.pointCode}>{ap.point?.point_code}</span>
                          <span className={styles.pointDesc}>{ap.point?.description}</span>
                          {questionCounts[ap.point_id] > 0 && (
                            <span
                              className={styles.qBadge}
                              title={`${questionCounts[ap.point_id]} question${questionCounts[ap.point_id] === 1 ? '' : 's'} assigned`}
                            >
                              {questionCounts[ap.point_id]} Q
                            </span>
                          )}
                          <label
                            className={styles.oosCheckLabel}
                            style={{ float: 'right', marginRight: 8 }}
                            onClick={e => e.stopPropagation()}
                            title={
                              hasOverride
                                ? `Out-of-Service: overridden ${effectiveOos ? 'ON' : 'OFF'} for this point`
                                : `Out-of-Service: inherited from route default (currently ${effectiveOos ? 'ON' : 'OFF'})`
                            }
                          >
                            <input
                              type="checkbox"
                              checked={effectiveOos}
                              disabled={!editable || oosSaving}
                              onChange={e => setPointOosOverride(ap.point_id, e.target.checked)}
                            />
                            {' '}OOS
                          </label>
                        </div>
                      );
                    })}
                    {allocPoints.length === 0 && (
                      <div className={styles.empty}>No points assigned to this route</div>
                    )}
                  </div>
                  {selAlloc.size === 1 && (
                    <button
                      className={styles.questionsBtn}
                      onClick={() => openQuestions([...selAlloc][0])}
                    >
                      Questions &rarr;
                    </button>
                  )}
                  {selAlloc.size > 1 && (
                    <button
                      className={styles.questionsBtn}
                      onClick={() => navigate(
                        `/setup/routes/${selRoute.id}/bulk-questions`,
                        { state: { siteId, routeId: selRoute.id, pointIds: [...selAlloc] } }
                      )}
                    >
                      Assign Questions to {selAlloc.size} Points &rarr;
                    </button>
                  )}
                  {!canEdit(siteId, 'questions') && (
                    <div className={styles.viewOnlyNote}>Questions are view only for this site</div>
                  )}
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
