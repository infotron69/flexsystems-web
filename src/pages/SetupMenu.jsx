import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useCanEditSite from '../hooks/useCanEditSite';
import styles from './SetupMenu.module.css';

// Drag-and-drop tile order -- not tenant-scoped (unlike DeviceSetupCode's
// saved FTP settings) since it's just this browser's personal arrangement
// of the menu, not tenant-specific data that could leak across logins.
const ORDER_STORAGE_KEY = 'setupMenuOrder';

function loadSavedOrder() {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOrder(order) {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage full/unavailable -- not worth surfacing an error for a
    // convenience feature; the tiles just fall back to default order.
  }
}

// gate: 'any' -- badge shows when the user has no edit rights on any site at
// all (mirrors each screen's own backend check); undefined -- never badged
// (either not an edit screen, or always-editable when reachable at all).
const ITEMS = [
  { label: 'Customer / Site Setup',   sub: 'Customers, sites, routes, points, questions', to: '/setup/customers', gate: 'any' },
  { label: 'Operator Setup',          sub: 'Patrol operators',                     to: '/setup/operators', gate: 'any' },
  { label: 'Question Setup',          sub: 'Question library',                     to: '/setup/questions', gate: 'any' },
  { label: 'Incident / Activity Setup', sub: 'Incident type hierarchy',            to: '/setup/incidents', gate: 'any' },
  { label: 'SOP Maintenance',         sub: 'Standard Operating Procedure checklists', to: '/setup/sops' },
  { label: 'Update PDA Files',        sub: 'Generate upload files for devices',    to: '/setup/pda', gate: 'any' },
  { label: 'Edit / Import Points',    sub: 'Edit an existing point, or bulk-create points from a spreadsheet', to: '/setup/points/import', gate: 'any' },
  { label: 'Device Setup Code',       sub: 'Generate a QR code to configure a FlexPatrol Mobile device', to: '/setup/device-setup-code', gate: 'any' },
  { label: 'Configuration Reports',   sub: 'Printable setup reports',              to: '/setup/reports' },
  { label: 'Audit Trail',             sub: 'Who changed what, and when',           to: '/setup/audit-log' },
];

// Managing which customer databases the app connects to is deliberately
// only reachable from the internal "flex" login, by a fully unrestricted
// admin there — never from a customer's own session, and never from a
// site-restricted user even on the flex login (the backend enforces both;
// this just keeps the tile from appearing where it'd be confusing or a red
// flag, or clickable only to hit a 403).
const ADMIN_ITEM = { label: 'Customers & Databases', sub: 'Manage tenant databases, login links, daily report emails', to: '/setup/tenants' };
const ALL_SITES_ITEM = { label: 'All Sites', sub: 'Every customer\'s sites in one list (read-only)', to: '/setup/all-sites' };

// Managing logins/access is unrestricted-admin-only (the backend enforces
// this too -- a site-restricted user, even with full edit rights, has no
// business browsing or changing the user roster).
const USER_SETUP_ITEM = { label: 'User Setup', sub: 'Login accounts and company access', to: '/setup/users' };

// Issuing an API key grants unrestricted read access to this tenant's
// patrol/configuration data to whatever external system holds it -- the
// same class of admin-only action as User Setup above.
// A customer admin's own name + report-email recipients (the flex login has
// the full Customers & Databases screen instead). Backend: require_unrestricted.
const MY_COMPANY_ITEM = { label: 'Company & Reports', sub: 'Your company name and who receives the report emails', to: '/setup/my-company' };

const INTEGRATION_TESTER_ITEM = { label: 'Integration API Tester', sub: 'Test SCADA/SAP/Oracle-style API access, manage API keys', to: '/setup/integration-tester' };

// A test patrol writes real transaction rows (createTransaction) that show
// up in that tenant's own reports/dashboard -- admin-only so a site-level
// user can't seed test data into their own live numbers.
const PDA_EMULATOR_ITEM = { label: 'PDA Emulator', sub: 'Walk a route/checklist like a real device, without a PDA', to: '/setup/pda-emulator' };

// Editing a shared lookup-list file writes to every configured site's
// ListFiles folder at once, with no per-site edit-scope check on the way in
// (unlike Route/Point/Question edits, which are all scoped to the caller's
// own sites) -- the backend enforces admin-only on the save endpoint too
// (require_unrestricted on PUT /pda/listfile), this just keeps the tile from
// appearing where it'd only 403 for a site-restricted user.
const LOTO_TYPES_ITEM = { label: 'LOTO Type List', sub: 'Lockout/Tagout type values for a PICKLIST/CHECKLIST question', to: '/setup/loto-types' };

export default function SetupMenu() {
  const navigate = useNavigate();
  const { me, unrestricted, hasAnyEditAccess } = useCanEditSite();
  const showAdminOnly = !me || unrestricted; // optimistic while loading; hides only once confirmed restricted
  const isFlexTenant = localStorage.getItem('tenant') === 'flex';
  const items = useMemo(() => {
    let list = isFlexTenant && showAdminOnly ? [...ITEMS, ADMIN_ITEM, ALL_SITES_ITEM] : ITEMS;
    if (showAdminOnly) list = [...list.slice(0, 2), USER_SETUP_ITEM, ...(isFlexTenant ? [] : [MY_COMPANY_ITEM]), ...list.slice(2), PDA_EMULATOR_ITEM, INTEGRATION_TESTER_ITEM, LOTO_TYPES_ITEM];
    return list;
  }, [isFlexTenant, showAdminOnly]);

  const [order, setOrder] = useState(loadSavedOrder);

  // Applies the saved drag order on top of `items` -- tiles named in `order`
  // come first in that sequence (skipping any no longer present, e.g. an
  // admin-only tile that disappeared for a now-restricted account), then
  // anything not yet in `order` (a tile added since the order was last
  // saved) is appended in its normal default-array position.
  const orderedItems = useMemo(() => {
    const byTo = new Map(items.map(item => [item.to, item]));
    const known = order.map(to => byTo.get(to)).filter(Boolean);
    const knownTos = new Set(known.map(item => item.to));
    const rest = items.filter(item => !knownTos.has(item.to));
    return [...known, ...rest];
  }, [items, order]);

  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const draggedRef = useRef(false); // suppresses the click navigation that follows a drop

  function handleDrop(dropIndex) {
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...orderedItems];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    const nextOrder = next.map(item => item.to);
    setOrder(nextOrder);
    saveOrder(nextOrder);
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>System Configuration</h2>
      <div className={styles.grid}>
        {orderedItems.map((item, i) => {
          const viewOnly = item.gate === 'any' && me && !hasAnyEditAccess;
          return (
            <div
              key={item.to}
              role="button"
              tabIndex={0}
              className={[
                styles.tile,
                dragIndex === i ? styles.dragging : '',
                overIndex === i && dragIndex !== i ? styles.dragOver : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={() => { setDragIndex(i); draggedRef.current = true; }}
              onDragOver={e => { e.preventDefault(); if (overIndex !== i) setOverIndex(i); }}
              onDragLeave={() => setOverIndex(prev => (prev === i ? null : prev))}
              onDrop={e => { e.preventDefault(); handleDrop(i); setDragIndex(null); setOverIndex(null); }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
                // Real drags don't fire a click event afterward, so there's
                // nothing here to suppress in practice -- but a drag that
                // got cancelled a few pixels in (some browsers/trackpads do
                // fire click for that) shouldn't be read as "open this
                // tile" either. Cleared on a short delay rather than
                // immediately so a click event already in flight still sees
                // it as true.
                setTimeout(() => { draggedRef.current = false; }, 0);
              }}
              onClick={() => {
                if (draggedRef.current) return;
                navigate(item.to);
              }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate(item.to); }}
            >
              <span className={styles.tileTop}>
                <span className={styles.tileLabel}>{item.label}</span>
                {viewOnly && <span className={styles.viewOnlyBadge}>View only</span>}
              </span>
              <span className={styles.tileSub}>{item.sub}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
