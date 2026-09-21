import { useNavigate } from 'react-router-dom';
import useCanEditSite from '../hooks/useCanEditSite';
import styles from './SetupMenu.module.css';

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

// Managing logins/access is unrestricted-admin-only (the backend enforces
// this too -- a site-restricted user, even with full edit rights, has no
// business browsing or changing the user roster).
const USER_SETUP_ITEM = { label: 'User Setup', sub: 'Login accounts and company access', to: '/setup/users' };

// Issuing an API key grants unrestricted read access to this tenant's
// patrol/configuration data to whatever external system holds it -- the
// same class of admin-only action as User Setup above.
const INTEGRATION_TESTER_ITEM = { label: 'Integration API Tester', sub: 'Test SCADA/SAP/Oracle-style API access, manage API keys', to: '/setup/integration-tester' };

// A test patrol writes real transaction rows (createTransaction) that show
// up in that tenant's own reports/dashboard -- admin-only so a site-level
// user can't seed test data into their own live numbers.
const PDA_EMULATOR_ITEM = { label: 'PDA Emulator', sub: 'Walk a route/checklist like a real device, without a PDA', to: '/setup/pda-emulator' };

export default function SetupMenu() {
  const navigate = useNavigate();
  const { me, unrestricted, hasAnyEditAccess } = useCanEditSite();
  const showAdminOnly = !me || unrestricted; // optimistic while loading; hides only once confirmed restricted
  let items = localStorage.getItem('tenant') === 'flex' && showAdminOnly ? [...ITEMS, ADMIN_ITEM] : ITEMS;
  if (showAdminOnly) items = [...items.slice(0, 2), USER_SETUP_ITEM, ...items.slice(2), PDA_EMULATOR_ITEM, INTEGRATION_TESTER_ITEM];
  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>System Configuration</h2>
      <div className={styles.grid}>
        {items.map(item => {
          const viewOnly = item.gate === 'any' && me && !hasAnyEditAccess;
          return (
            <button
              key={item.to}
              className={styles.tile}
              onClick={() => navigate(item.to)}
            >
              <span className={styles.tileTop}>
                <span className={styles.tileLabel}>{item.label}</span>
                {viewOnly && <span className={styles.viewOnlyBadge}>View only</span>}
              </span>
              <span className={styles.tileSub}>{item.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
