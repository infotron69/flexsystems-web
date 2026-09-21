import { useEffect, useState } from 'react';
import {
  listIntegrationApiKeys, createIntegrationApiKey, revokeIntegrationApiKey,
  callIntegrationEndpoint, getCustomers, getSites, getRoutes,
} from '../api/client';
import styles from './Questions.module.css';

// Mirrors app/routers/integrations.py's actual query params per endpoint.
const ENDPOINTS = {
  transactions: ['site_id', 'route_id', 'since', 'limit'],
  customers: [],
  sites: ['customer_id'],
  routes: ['site_id'],
  points: ['site_id'],
  operators: [],
};

export default function IntegrationApiTester() {
  const tenantId = localStorage.getItem('tenant');

  const [keys, setKeys] = useState([]);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(null); // raw key string, shown once
  const [keyErr, setKeyErr] = useState(null);

  const [endpoint, setEndpoint] = useState('transactions');
  const [paramValues, setParamValues] = useState({});
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'apikey'
  const [testApiKey, setTestApiKey] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { status, data }

  // Picker data for the dropdowns below -- fetched via the normal (already
  // logged-in) app API purely to fill in human-readable choices, regardless
  // of which auth mode is selected for the actual Send Request call itself.
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [routes, setRoutes] = useState([]);

  function loadKeys() {
    listIntegrationApiKeys(tenantId).then(setKeys).finally(() => setKeysLoaded(true));
  }

  useEffect(() => {
    loadKeys();
    getCustomers().then(setCustomers);
    getSites().then(setSites);
    getRoutes().then(setRoutes);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateKey() {
    if (!newLabel.trim()) return;
    setCreating(true);
    setKeyErr(null);
    try {
      const res = await createIntegrationApiKey(tenantId, newLabel.trim());
      setJustCreated(res.api_key);
      setNewLabel('');
      loadKeys();
    } catch (ex) {
      setKeyErr(ex.response?.data?.detail ?? 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId) {
    if (!confirm('Revoke this API key? Any system using it will immediately lose access.')) return;
    await revokeIntegrationApiKey(keyId);
    loadKeys();
  }

  function updateParam(name, value) {
    setParamValues(prev => ({ ...prev, [name]: value }));
  }

  async function handleSend() {
    setSending(true);
    setResult(null);
    const params = {};
    for (const [k, v] of Object.entries(paramValues)) {
      if (v) params[k] = v;
    }
    try {
      const res = await callIntegrationEndpoint(endpoint, params, authMode === 'apikey' ? testApiKey : null);
      setResult({ status: res.status, data: res.data });
    } catch (ex) {
      setResult({ status: ex.response?.status ?? 'Network Error', data: ex.response?.data ?? { detail: String(ex) } });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Integration API Tester</h2>
      </div>
      <p className={styles.subheading}>
        Test the /api/integrations endpoints the way an external system (SCADA, SAP, Oracle) would --
        either with your own login, or with a real issued API key.
      </p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ── API Keys panel ── */}
        <div className={styles.form} style={{ flex: '1 1 340px', maxWidth: 420 }}>
          <h3 style={{ margin: '0 0 8px' }}>API Keys — {tenantId}</h3>

          {justCreated && (
            <div style={{ background: '#eef2fc', border: '1px solid #cdd8f5', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: '0.85rem' }}>
              <strong>New key created — copy it now, it won't be shown again:</strong>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 6, userSelect: 'all' }}>{justCreated}</div>
              <button className={styles.cancelBtn} style={{ marginTop: 8 }} onClick={() => setJustCreated(null)}>Dismiss</button>
            </div>
          )}

          <div className={styles.formRow}>
            <label className={styles.formLabel}>New key label</label>
            <input
              className={styles.formInputWide}
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="e.g. Acme SCADA gateway"
            />
          </div>
          {keyErr && <div className={styles.formErr}>{keyErr}</div>}
          <button className={styles.saveBtn} onClick={handleCreateKey} disabled={creating || !newLabel.trim()}>
            {creating ? 'Creating…' : '+ Create Key'}
          </button>

          <div style={{ marginTop: 16 }}>
            {!keysLoaded ? (
              <div className={styles.loading}>Loading…</div>
            ) : keys.length === 0 ? (
              <p style={{ color: '#888', fontSize: '0.85rem' }}>No keys yet for this tenant.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {keys.map(k => (
                  <li
                    key={k.id}
                    className={styles.listItem}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{k.label}</div>
                      <div style={{ fontSize: '0.76rem', color: '#888' }}>
                        {k.active ? 'Active' : 'Revoked'} · created {new Date(k.created_at).toLocaleString()}
                      </div>
                    </div>
                    {k.active && (
                      <button className={styles.cancelBtn} onClick={() => handleRevoke(k.id)}>Revoke</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Try It panel ── */}
        <div className={styles.form} style={{ flex: '1 1 420px', maxWidth: 560 }}>
          <h3 style={{ margin: '0 0 8px' }}>Try It</h3>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Endpoint</label>
            <select
              className={styles.formInputWide}
              value={endpoint}
              onChange={e => { setEndpoint(e.target.value); setParamValues({}); setResult(null); }}
            >
              {Object.keys(ENDPOINTS).map(ep => (
                <option key={ep} value={ep}>/api/integrations/{ep}</option>
              ))}
            </select>
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Authenticate as</label>
            <select className={styles.formInputWide} value={authMode} onChange={e => setAuthMode(e.target.value)}>
              <option value="login">My login (normal JWT)</option>
              <option value="apikey">An API key</option>
            </select>
          </div>

          {authMode === 'apikey' && (
            <div className={styles.formRow}>
              <label className={styles.formLabel}>API key</label>
              <input
                className={styles.formInputWide}
                style={{ textTransform: 'none' }}
                value={testApiKey}
                onChange={e => setTestApiKey(e.target.value)}
                placeholder="Paste a key from the panel on the left, or any value to test rejection"
              />
            </div>
          )}

          {ENDPOINTS[endpoint].map(p => (
            <div className={styles.formRow} key={p}>
              <label className={styles.formLabel}>{p}</label>
              {p === 'since' ? (
                <input
                  type="date"
                  className={styles.formInputWide}
                  value={paramValues[p] ?? ''}
                  onChange={e => updateParam(p, e.target.value)}
                />
              ) : p === 'customer_id' ? (
                <select className={styles.formInputWide} value={paramValues[p] ?? ''} onChange={e => updateParam(p, e.target.value)}>
                  <option value="">— all customers —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </select>
              ) : p === 'site_id' ? (
                <select className={styles.formInputWide} value={paramValues[p] ?? ''} onChange={e => updateParam(p, e.target.value)}>
                  <option value="">— all sites —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
                </select>
              ) : p === 'route_id' ? (
                <select className={styles.formInputWide} value={paramValues[p] ?? ''} onChange={e => updateParam(p, e.target.value)}>
                  <option value="">— all routes —</option>
                  {routes.map(r => <option key={r.id} value={r.id}>{r.display_name || r.name} ({r.id})</option>)}
                </select>
              ) : (
                <input className={styles.formInputWide} value={paramValues[p] ?? ''} onChange={e => updateParam(p, e.target.value)} />
              )}
            </div>
          ))}

          <button
            className={styles.saveBtn}
            onClick={handleSend}
            disabled={sending || (authMode === 'apikey' && !testApiKey.trim())}
          >
            {sending ? 'Sending…' : 'Send Request'}
          </button>

          {result && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: result.status === 200 ? '#16a34a' : '#b91c1c' }}>
                Status: {result.status}
              </div>
              <pre style={{ background: '#1a2332', color: '#e6edf7', padding: 12, borderRadius: 6, fontSize: '0.78rem', maxHeight: 400, overflow: 'auto' }}>
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
