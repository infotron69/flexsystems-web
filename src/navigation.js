import { matchPath } from 'react-router-dom';

// The one place that says where "Back" goes. Layout shows a BackButton on
// every screen listed here, so each screen has the same button in the same
// spot with the same wording ("← <where it goes>").
//
// Not listed on purpose:
//   - top-level screens (Dashboard, Setup menu, Reports, Transactions)
//   - screens whose parent depends on data they load, which render their own
//     BackButton: Routes (/setup/sites/:siteId/routes), and the question
//     editors (point / bulk), which have it in their toolbar
//   - the PDA emulator, which simulates a device and has its own app bar
const BACK_TARGETS = [
  ['/setup/reports/:report', '/setup/reports', 'Setup Reports'],
  ['/setup/reports', '/setup', 'Setup'],
  ['/reports/:report', '/reports', 'Reports'],
  ['/setup/customers/:customerId/sites', '/setup/customers', 'Customers'],
  ['/setup/sops', '/setup/incidents', 'Incidents'],
  ['/setup/customers', '/setup', 'Setup'],
  ['/setup/sites', '/setup', 'Setup'],
  ['/setup/operators', '/setup', 'Setup'],
  ['/setup/users', '/setup', 'Setup'],
  ['/setup/questions', '/setup', 'Setup'],
  ['/setup/incidents', '/setup', 'Setup'],
  ['/setup/pda', '/setup', 'Setup'],
  ['/setup/loto-types', '/setup', 'Setup'],
  ['/setup/points/import', '/setup', 'Setup'],
  ['/setup/device-setup-code', '/setup', 'Setup'],
  ['/setup/tenants', '/setup', 'Setup'],
  ['/setup/audit-log', '/setup', 'Setup'],
  ['/setup/integration-tester', '/setup', 'Setup'],
];

// A screen reached from somewhere other than its usual parent (Question Setup
// opens from Incidents, SOP Maintenance and the point editor as well as the
// Setup menu) is sent back to wherever it was opened from: the opener passes
// { backTo, backLabel } as navigation state.
export function getBackTarget(pathname, state) {
  for (const [pattern, to, label] of BACK_TARGETS) {
    if (matchPath({ path: pattern, end: true }, pathname)) {
      if (state?.backTo) return { to: state.backTo, label: state.backLabel || 'Back' };
      return { to, label };
    }
  }
  return null;
}
