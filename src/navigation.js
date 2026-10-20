import { matchPath } from 'react-router-dom';

// Which screens get the standard Back button (Layout renders it), and where
// it goes when there's no earlier page in this tab's history to return to
// (see useGoBack) -- normally Back just returns to the page you came from.
//
// Not listed on purpose:
//   - top-level screens (Dashboard, Setup menu, Reports, Transactions)
//   - screens whose fallback parent depends on data they load, which render
//     their own BackButton: Routes (/setup/sites/:siteId/routes), and the
//     question editors (point / bulk), which have it in their toolbar
//   - the PDA emulator, which simulates a device and has its own app bar
const BACK_FALLBACKS = [
  ['/setup/reports/:report', '/setup/reports'],
  ['/setup/reports', '/setup'],
  ['/reports/:report', '/reports'],
  ['/setup/customers/:customerId/sites', '/setup/customers'],
  ['/setup/sops', '/setup/incidents'],
  ['/setup/customers', '/setup'],
  ['/setup/sites', '/setup'],
  ['/setup/operators', '/setup'],
  ['/setup/users', '/setup'],
  ['/setup/questions', '/setup'],
  ['/setup/incidents', '/setup'],
  ['/setup/pda', '/setup'],
  ['/setup/loto-types', '/setup'],
  ['/setup/points/import', '/setup'],
  ['/setup/device-setup-code', '/setup'],
  ['/setup/tenants', '/setup'],
  ['/setup/all-sites', '/setup'],
  ['/setup/audit-log', '/setup'],
  ['/setup/integration-tester', '/setup'],
];

// The fallback parent for this screen, or null if it has no standard Back.
export function getBackFallback(pathname) {
  for (const [pattern, fallback] of BACK_FALLBACKS) {
    if (matchPath({ path: pattern, end: true }, pathname)) return fallback;
  }
  return null;
}
