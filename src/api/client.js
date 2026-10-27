import axios from 'axios';

// Backend routes all live under /api (see app/main.py) so they never collide
// with frontend SPA routes of the same name (e.g. /transactions) once both
// are served from a single origin. In dev, Vite proxies /api to the backend;
// in production set VITE_API_URL to override.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({ baseURL: BASE_URL });

// Attach JWT to every request if we have one
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear the token and bounce back to this session's tenant-specific
// login link (never the bare customer-less /login page — that always shows
// a generic "use your provided link" message, not a picker).
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      const tenant = localStorage.getItem('tenant');
      window.location.href = tenant ? `/login/${tenant}` : '/login';
    }
    return Promise.reject(err);
  }
);

export default client;

// Deliberately has NONE of the interceptors above -- used only by the
// Integration API Tester's "send test request" action, where a 401 is often
// an intentional test (a bad/revoked API key) rather than a real expired
// session. Routing that through `client` would trigger the global 401
// handler and log the admin out of the whole app just for testing a key.
export const rawClient = axios.create({ baseURL: BASE_URL });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
// Single-tenant lookup only — never the full customer roster, so a
// customer's private login link can't be used to discover other customers.
export const getTenant = (tenantId) => client.get(`/auth/tenants/${tenantId}`).then(r => r.data);

export async function login(tenant, userCode, password) {
  const form = new URLSearchParams();
  form.append('tenant', tenant);
  form.append('username', userCode);
  form.append('password', password);
  const res = await client.post('/auth/token', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data.access_token;
}

export const getMe = () => client.get('/auth/me').then(r => r.data);

// ---------------------------------------------------------------------------
// Users  (login accounts, scoped to specific sites or unrestricted)
// ---------------------------------------------------------------------------
export const getUsers        = ()          => client.get('/auth/users').then(r => r.data);
export const getUser         = (userCode)  => client.get(`/auth/users/${userCode}`).then(r => r.data);
export const createUser      = (body)      => client.post('/auth/users', body).then(r => r.data);
export const setUserPassword = (userCode, password) =>
  client.put(`/auth/users/${userCode}/password`, { password }).then(r => r.data);
export const setUserSites    = (userCode, siteAccess) =>
  client.put(`/auth/users/${userCode}/sites`, { site_access: siteAccess }).then(r => r.data);
export const setUserReports  = (userCode, reports) => client.put(`/auth/users/${userCode}/reports`, reports).then(r => r.data);
export const deleteUser      =(userCode)  => client.delete(`/auth/users/${userCode}`);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const getCustomers    = ()          => client.get('/customers').then(r => r.data);
export const getCustomer     = (id)        => client.get(`/customers/${id}`).then(r => r.data);
export const createCustomer  = (body)      => client.post('/customers', body).then(r => r.data);
export const updateCustomer  = (id, body)  => client.patch(`/customers/${id}`, body).then(r => r.data);
export const deleteCustomer  = (id)        => client.delete(`/customers/${id}`);

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------
export const getSites    = (params) => client.get('/sites', { params }).then(r => r.data);
export const getSite     = (id)     => client.get(`/sites/${id}`).then(r => r.data);
export const createSite  = (body)     => client.post('/sites', body).then(r => r.data);
export const nextSiteCode = () => client.get('/sites/next-site-code').then(r => r.data.code);
export const updateSite  = (id, body) => client.patch(`/sites/${id}`, body).then(r => r.data);
export const deleteSite  = (id)       => client.delete(`/sites/${id}`);

// ---------------------------------------------------------------------------
// Routes  (filtered by site_id)
// ---------------------------------------------------------------------------
export const getRoutes   = (params)   => client.get('/routes', { params }).then(r => r.data);
export const getRoute    = (id)       => client.get(`/routes/${id}`).then(r => r.data);
export const createRoute = (body)     => client.post('/routes', body).then(r => r.data);
export const nextRouteCode = () => client.get('/routes/next-route-code').then(r => r.data.code);
export const updateRoute = (id, body) => client.patch(`/routes/${id}`, body).then(r => r.data);
export const deleteRoute = (id)       => client.delete(`/routes/${id}`);

// Copies every point allocation + question checklist from another route
// (same site only) onto this one; points already on this route are left
// untouched. Returns { points_copied, points_skipped, questions_copied }.
export const copyRoutePointsAndQuestions = (routeId, sourceRouteId) =>
  client.post(`/routes/${routeId}/copy-from/${sourceRouteId}`).then(r => r.data);

// Points assigned to a route (RoutePointSetup, includes embedded point detail)
export const getRoutePoints = (routeId) =>
  client.get(`/routes/${routeId}/points`).then(r => r.data);

export const updateRoutePoint = (routeId, pointId, body) =>
  client.patch(`/routes/${routeId}/points/${pointId}`, body).then(r => r.data);
export const addPointToRoute = (routeId, body) =>
  client.post(`/routes/${routeId}/points`, body).then(r => r.data);
export const removePointFromRoute = (routeId, pointId) =>
  client.delete(`/routes/${routeId}/points/${pointId}`);

// Questions assigned to a route+point
export const getRoutePointQuestions = (routeId, pointId) =>
  client.get(`/routes/${routeId}/points/${pointId}/questions`).then(r => r.data);

// point_id -> question count, for every point on the route that has at least
// one -- used to filter out empty points from Preload/bulk-assign pickers.
export const getRoutePointQuestionCounts = (routeId) =>
  client.get(`/routes/${routeId}/points/question-counts`).then(r => r.data);

// Every point code used as a jump destination on any route's checklist,
// system-wide -- powers the SOP Maintenance report's "in use" check.
export const getAllJumpTargets = () => client.get('/routes/jump-targets').then(r => r.data);

// point_id -> RoutePointQuestion[] for every point on a route, in one call --
// powers the SOP Maintenance report, which used to fire one request per point.
export const getRoutePointQuestionsAll = (routeId) =>
  client.get(`/routes/${routeId}/points/questions-all`).then(r => r.data);

// route_id -> RoutePointSetup[] for every route the caller can see, in one
// call -- powers the Route Setup report, which used to fire one request per
// route (140+ on a real tenant).
export const getAllRoutePoints = () => client.get('/routes/points-all').then(r => r.data);

// ---------------------------------------------------------------------------
// Questions library  (Tbl_Questions — the master list, not route assignments)
// ---------------------------------------------------------------------------
export const getAllQuestions  = (params)    => client.get('/questions', { params }).then(r => r.data);
export const createQuestion   = (body)      => client.post('/questions', body).then(r => r.data);
export const updateQuestion   = (id, body)  => client.patch(`/questions/${id}`, body).then(r => r.data);
export const deleteQuestion   = (id)        => client.delete(`/questions/${id}`);

// Replace the entire question list for a route+point (delete-and-add)
export const replaceRoutePointQuestions = (routeId, pointId, body) =>
  client.put(`/routes/${routeId}/points/${pointId}/questions`, body).then(r => r.data);

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------
export const getPoints   = (params)   => client.get('/points', { params }).then(r => r.data);
export const getPoint    = (id)       => client.get(`/points/${id}`).then(r => r.data);
export const createPoint = (body)     => client.post('/points', body).then(r => r.data);
export const updatePoint = (id, body) => client.patch(`/points/${id}`, body).then(r => r.data);
export const deletePoint = (id)       => client.delete(`/points/${id}`);
export const getPointUsage = (id)     => client.get(`/points/${id}/usage`).then(r => r.data);
export const nextSopCode = (name)     => client.get('/points/next-sop-code', { params: { name } }).then(r => r.data.code);
export const nextPointCode = (siteId) => client.get('/points/next-point-code', { params: { site_id: siteId } }).then(r => r.data.code);

// Bulk-create points from an uploaded spreadsheet, allocate them onto a
// route, and optionally clone another point's question checklist onto
// each new one. site_id/route_id/preloadFromPointId are separate form
// fields, not read from the file.
export const importPoints = (file, siteId, routeId, preloadFromPointId) => {
  const form = new FormData();
  form.append('file', file);
  form.append('site_id', siteId);
  form.append('route_id', routeId);
  if (preloadFromPointId) form.append('preload_from_point_id', preloadFromPointId);
  return client.post('/points/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

// Resolve a point by its exact code (e.g. "CEMERLIGHT") — returns array
export const getPointsByCode = (code) =>
  client.get('/points', { params: { point_code: code } }).then(r => r.data);

// All questions for a point across every route (for cross-route clone-jump expansion)
export const getPointAllQuestions = (pointId) =>
  client.get(`/points/${pointId}/questions`).then(r => r.data);

// ---------------------------------------------------------------------------
// Incidents  (4-level: Master → SubCat1 → SubCat2 → SubCat3)
// ---------------------------------------------------------------------------
export const getIncidents        = ()        => client.get('/incidents').then(r => r.data);
export const createIncident      = (body)    => client.post('/incidents', body).then(r => r.data);
export const updateIncident      = (id, body)=> client.patch(`/incidents/${id}`, body).then(r => r.data);
export const deleteIncident      = (id)      => client.delete(`/incidents/${id}`);

export const getIncidentSub1     = (masterId)=> client.get(`/incidents/${masterId}/sub1`).then(r => r.data);
export const createIncidentSub1  = (body)    => client.post('/incidents/sub1', body).then(r => r.data);
export const updateIncidentSub1  = (id, body)=> client.patch(`/incidents/sub1/${id}`, body).then(r => r.data);
export const deleteIncidentSub1  = (id)      => client.delete(`/incidents/sub1/${id}`);

export const getIncidentSub2     = (sub1Id)  => client.get(`/incidents/sub1/${sub1Id}/sub2`).then(r => r.data);
export const createIncidentSub2  = (body)    => client.post('/incidents/sub2', body).then(r => r.data);
export const updateIncidentSub2  = (id, body)=> client.patch(`/incidents/sub2/${id}`, body).then(r => r.data);
export const deleteIncidentSub2  = (id)      => client.delete(`/incidents/sub2/${id}`);

export const getIncidentSub3     = (sub2Id)  => client.get(`/incidents/sub2/${sub2Id}/sub3`).then(r => r.data);
export const createIncidentSub3  = (body)    => client.post('/incidents/sub3', body).then(r => r.data);
export const updateIncidentSub3  = (id, body)=> client.patch(`/incidents/sub3/${id}`, body).then(r => r.data);
export const deleteIncidentSub3  = (id)      => client.delete(`/incidents/sub3/${id}`);

// "Which incident level references this SOP point?" -- powers the read-only
// lookup field on the SOP Maintenance screen.
export const sopLookup = (pointCode) => client.get(`/incidents/sop-lookup/${pointCode}`).then(r => r.data);
export const sopLookupAll = () => client.get('/incidents/sop-lookup-all').then(r => r.data);
export const nextIncidentCode = (level, name) =>
  client.get('/incidents/next-code', { params: { level, name } }).then(r => r.data.code);

// ---------------------------------------------------------------------------
// Guards (Operators)
// ---------------------------------------------------------------------------
export const getGuards    = (params)     => client.get('/guards', { params }).then(r => r.data);
export const createGuard  = (body)       => client.post('/guards', body).then(r => r.data);
export const updateGuard  = (id, body)   => client.patch(`/guards/${id}`, body).then(r => r.data);
export const deleteGuard  = (id)         => client.delete(`/guards/${id}`);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export const getTransactions   = (params) => client.get('/transactions', { params }).then(r => r.data);
export const createTransaction = (body)   => client.post('/transactions', body).then(r => r.data);

// Raw contents of Tbl_PDA — just the most recent PDA download batch, not the
// permanent historical log (that's getTransactions, backed by Tbl_Transaction_Asset).
export const getLastDownload = () => client.get('/transactions/last-download').then(r => r.data);

// ---------------------------------------------------------------------------
// PDA file generation
// ---------------------------------------------------------------------------
export const getPdaSites    = ()         => client.get('/pda/sites').then(r => r.data);
export const getListFile    = (filename) => client.get(`/pda/listfile/${encodeURIComponent(filename)}`, { responseType: 'text' }).then(r => r.data);
export const saveListFile   = (filename, content) => client.put(`/pda/listfile/${encodeURIComponent(filename)}`, { content }).then(r => r.data);
export const createCombinedGroup = (name, siteCodes) => client.post('/pda/groups', { name, site_codes: siteCodes }).then(r => r.data);
export const deleteCombinedGroup = (name) => client.delete(`/pda/groups/${encodeURIComponent(name)}`).then(r => r.data);
export const generateAllPda =()         => client.post('/pda/generate').then(r => r.data);
export const generatePda    = (siteName) => client.post(`/pda/generate/${siteName}`).then(r => r.data);

// ---------------------------------------------------------------------------
// Tenant registry (admin-only — only reachable when logged into the "flex"
// customer; the backend enforces this regardless of what the UI hides).
// ---------------------------------------------------------------------------
export const getAdminTenants   = ()           => client.get('/tenants').then(r => r.data);
export const createAdminTenant = (body)       => client.post('/tenants', body).then(r => r.data);
export const updateAdminTenant = (id, body)   => client.put(`/tenants/${id}`, body).then(r => r.data);
export const deleteAdminTenant = (id)         => client.delete(`/tenants/${id}`);
export const getAllSites       = ()           => client.get('/tenants/all-sites').then(r => r.data);
// A customer admin's own company settings (name + report recipients only).
export const getMyCompany        = ()     => client.get('/my-company').then(r => r.data);
export const updateMyCompany     = (body) => client.put('/my-company', body).then(r => r.data);
export const sendMyTestReport    = ()     => client.post('/my-company/send-test-report').then(r => r.data);
export const sendTestReport    = (id)         => client.post(`/tenants/${id}/send-test-report`).then(r => r.data);

// SMTP settings (same admin-only gating as the tenant registry above).
export const getSmtpSettings    = ()     => client.get('/settings/smtp').then(r => r.data);
export const updateSmtpSettings = (body) => client.put('/settings/smtp', body).then(r => r.data);

// Device Setup Code (Setup > Device Setup Code) -- per-tenant, unlike SMTP
// above. GET returns null if this tenant hasn't saved one yet.
export const getDeviceSetupConfig    = ()     => client.get('/device-setup-config').then(r => r.data);
export const updateDeviceSetupConfig = (body) => client.put('/device-setup-config', body).then(r => r.data);

// ---------------------------------------------------------------------------
// Audit log (Setup change history — see app.audit on the backend)
// ---------------------------------------------------------------------------
export const getAuditLog = (params) => client.get('/audit-log', { params }).then(r => r.data);

// ---------------------------------------------------------------------------
// Integration API test surface (SCADA/SAP/Oracle-style external consumers --
// see app/routers/integrations.py). callIntegrationEndpoint accepts an
// optional raw API key to test the machine-to-machine auth path instead of
// the normal logged-in session.
// ---------------------------------------------------------------------------
// Uses rawClient (see above) rather than the normal `client` -- an
// intentionally-bad API key correctly 401s, and that must NOT log the admin
// running this test out of their own session.
export const callIntegrationEndpoint = (endpoint, params, apiKey) => {
  const headers = apiKey ? { 'X-API-Key': apiKey } : { Authorization: `Bearer ${localStorage.getItem('token')}` };
  return rawClient.get(`/integrations/${endpoint}`, { params, headers });
};

export const listIntegrationApiKeys  = (tenantId) =>
  client.get('/integration-api-keys', { params: { tenant_id: tenantId } }).then(r => r.data);
export const createIntegrationApiKey = (tenantId, label) =>
  client.post('/integration-api-keys', null, { params: { tenant_id: tenantId, label } }).then(r => r.data);
export const revokeIntegrationApiKey = (keyId) =>
  client.delete(`/integration-api-keys/${keyId}`).then(r => r.data);
