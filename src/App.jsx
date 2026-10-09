import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout         from './components/Layout';
import Login          from './pages/Login';
import Dashboard      from './pages/Dashboard';
import Transactions   from './pages/Transactions';
import SetupMenu      from './pages/SetupMenu';
import Customers      from './pages/Customers';
import Sites          from './pages/Sites';
import RouteSetup     from './pages/RouteSetup';
import PointQuestions from './pages/PointQuestions';
import BulkPointQuestions from './pages/BulkPointQuestions';
import Questions      from './pages/Questions';
import Guards         from './pages/Guards';
import Users          from './pages/Users';
import Incidents      from './pages/Incidents';
import SopMaintenance from './pages/SopMaintenance';
import SopMaintReport from './pages/SopMaintReport';
import SetupPDA       from './pages/SetupPDA';
import LotoTypeList   from './pages/LotoTypeList';
import PdaEmulator    from './pages/PdaEmulator';
import ImportPoints   from './pages/ImportPoints';
import DeviceSetupCode from './pages/DeviceSetupCode';
import SetupReports         from './pages/SetupReports';
import Reports              from './pages/Reports';
import SiteSummaryReport    from './pages/SiteSummaryReport';
import RouteConfigReport    from './pages/RouteConfigReport';
import RoutePointBarcodesReport from './pages/RoutePointBarcodesReport';
import RouteQuestionsReport from './pages/RouteQuestionsReport';
import QuestionsReport      from './pages/QuestionsReport';
import OperatorReport       from './pages/OperatorReport';
import IncidentReport       from './pages/IncidentReport';
import TransactionReport    from './pages/TransactionReport';
import GpsMapReport         from './pages/GpsMapReport';
import PerformanceMetricsReport from './pages/PerformanceMetricsReport';
import LocationPerformanceReport from './pages/LocationPerformanceReport';
import AdminTenants         from './pages/AdminTenants';
import AuditLog             from './pages/AuditLog';
import IntegrationApiTester from './pages/IntegrationApiTester';

function RequireAuth({ children }) {
  if (localStorage.getItem('token')) return children;
  const tenant = localStorage.getItem('tenant');
  return <Navigate to={tenant ? `/login/${tenant}` : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/login/:tenant" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />

          {/* ── Setup section ── */}
          <Route path="setup"           element={<SetupMenu />} />
          <Route path="setup/customers" element={<Customers />} />
          <Route path="setup/customers/:customerId/sites" element={<Sites />} />
          <Route path="setup/sites"     element={<Sites />} />
          <Route path="setup/sites/:siteId/routes" element={<RouteSetup />} />
          <Route path="setup/operators" element={<Guards />} />
          <Route path="setup/users"     element={<Users />} />
          <Route path="setup/questions" element={<Questions />} />
          <Route path="setup/incidents" element={<Incidents />} />
          <Route path="setup/sops" element={<SopMaintenance />} />
          <Route path="setup/pda"       element={<SetupPDA />} />
          <Route path="setup/loto-types" element={<LotoTypeList />} />
          <Route path="setup/pda-emulator" element={<PdaEmulator />} />
          <Route path="setup/pda-emulator/:routeId/:pointId" element={<PdaEmulator />} />
          <Route path="setup/points/import" element={<ImportPoints />} />
          <Route path="setup/device-setup-code" element={<DeviceSetupCode />} />
          <Route path="setup/tenants"   element={<AdminTenants />} />
          <Route path="setup/audit-log" element={<AuditLog />} />
          <Route path="setup/integration-tester" element={<IntegrationApiTester />} />

          {/* ── Configuration Reports (nested under Setup) ── */}
          <Route path="setup/reports"                    element={<SetupReports />} />
          <Route path="setup/reports/site-summary"       element={<SiteSummaryReport />} />
          <Route path="setup/reports/routes"             element={<RouteConfigReport />} />
          <Route path="setup/reports/point-barcodes"     element={<RoutePointBarcodesReport />} />
          <Route path="setup/reports/route-questions"    element={<RouteQuestionsReport />} />
          <Route path="setup/reports/questions"          element={<QuestionsReport />} />
          <Route path="setup/reports/operators"          element={<OperatorReport />} />
          <Route path="setup/reports/incidents"          element={<IncidentReport />} />
          <Route path="setup/reports/sops"               element={<SopMaintReport />} />

          {/* ── Reports section (top-level, operational/PDA reports) ── */}
          <Route path="reports"                    element={<Reports />} />
          <Route path="reports/transactions"        element={<TransactionReport />} />
          <Route path="reports/gps-map"             element={<GpsMapReport />} />
          <Route path="reports/performance"         element={<PerformanceMetricsReport />} />
          <Route path="reports/location-performance" element={<LocationPerformanceReport />} />

          {/* Questions grid — routeId + pointId only (no siteId) */}
          <Route
            path="setup/routes/:routeId/points/:pointId/questions"
            element={<PointQuestions />}
          />

          {/* Multi-point question assignment — one list applied to several points at once */}
          <Route
            path="setup/routes/:routeId/bulk-questions"
            element={<BulkPointQuestions />}
          />

          {/* Other pages */}
          <Route path="transactions" element={<Transactions />} />

          {/* Legacy redirects */}
          <Route path="guards"    element={<Navigate to="/setup/operators" replace />} />
          <Route path="incidents" element={<Navigate to="/setup/incidents" replace />} />
          {/* Route editing is always reached via a site now (customer is the entry point) */}
          <Route path="setup/routes" element={<Navigate to="/setup/customers" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
