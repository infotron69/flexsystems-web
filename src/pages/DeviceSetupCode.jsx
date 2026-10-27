import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { getDeviceSetupConfig, updateDeviceSetupConfig, getSites } from '../api/client';
import styles from './DeviceSetupCode.module.css';

// Mirrors exactly the shape FlexPatrol Mobile's UPDATE_SETTINGS action (and
// AsyncStorage 'settings' key) expects - see AppStore.js and MainScreen.js's
// openSetupScanner. Scanning the generated code applies these values
// directly, with no manual entry screen in the app to fat-finger a typo into.
const emptyForm = {
  gpsEnabled: true,
  autoSyncOnEndRoute: true,
  cameraEnabled: true,
  scanningTypes: ['camera', 'qr'],
  host: '8.44.153.246',
  localHost: '8.44.153.246',
  port: '21',
  user: 'Flex-Demo',
  password: 'flexdemo',
  uploadPath: 'upload/',
  downloadPath: 'download/FTP/',
};

// The FlexPatrol Mobile app (React Native rewrite)'s Device Setup screen
// locks its on-device "EDIT" button behind a second, distinct QR code --
// shape {unlockEdit: true, token} -- so a device left with a guard (which
// only ever gets the regular setup code above) can't also be used to edit
// its own FTP settings. See DeviceSetupScreen.js's header comment: the
// unlock only lasts for that screen visit, never persisted, and re-locks on
// leaving. The token is hardcoded in the app and shared across every
// tenant/device for now -- rotating it means shipping a new app build, not
// anything changeable from here.
const EDIT_UNLOCK_TOKEN = 'FlexPatrol2026Edit';

// Persisted per-tenant (not globally) -- this browser may be used to log
// into more than one tenant, and each tenant's FTP host/credentials are
// unrelated; keying by the bare storage name would leak one tenant's PDA
// settings into another's session. Already the same trust level as the QR
// code itself: the form's own hint below already warns the FTP password is
// embedded in that code as plain text, so persisting it locally here isn't
// a new exposure.
const STORAGE_KEY_PREFIX = 'deviceSetupCodeForm';

function loadSavedForm() {
  try {
    const tenant = localStorage.getItem('tenant') || '';
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}:${tenant}`);
    if (!raw) return emptyForm;
    return { ...emptyForm, ...JSON.parse(raw) };
  } catch {
    return emptyForm;
  }
}

// The server stores this tenant-wide (see app.device_setup on the backend)
// in the same snake_case shape every other endpoint here uses -- separate
// from buildPayload() below, which builds the camelCase shape the MOBILE
// APP itself expects inside the actual QR code and must never change.
function toServerConfig(form) {
  return {
    gps_enabled: form.gpsEnabled,
    auto_sync_on_end_route: form.autoSyncOnEndRoute,
    camera_enabled: form.cameraEnabled,
    scanning_types: form.scanningTypes,
    // host/localHost are hostnames or IPs -- case-insensitive, so this
    // matches the visual all-caps every other text input in this app
    // already shows (see index.css). user/password/uploadPath/downloadPath
    // are real FTP credentials and Unix-style paths -- both are genuinely
    // case-sensitive on a real FTP server, so those are saved exactly as
    // typed, the same exception already made for Question.mask/file_name.
    host: form.host.trim().toUpperCase(),
    local_host: form.localHost.trim().toUpperCase(),
    port: form.port,
    user: form.user,
    password: form.password,
    upload_path: form.uploadPath,
    download_path: form.downloadPath,
  };
}

// Only sites that actually have their own login or their own device settings
// are stored (blank / unticked = use the tenant-wide ones).
function storedSiteLogins(logins) {
  return Object.fromEntries(
    Object.entries(logins)
      .filter(([, l]) => l.user?.trim() || l.password || l.settings)
      .map(([code, l]) => [code, { user: l.user?.trim() ?? '', password: l.password ?? '', settings: l.settings ?? null }]),
  );
}

// A site's device settings (GPS, auto-sync, camera, scanning types) as the
// form shape buildPayload() takes -- the site's own when it has them,
// otherwise the tenant-wide ones.
function siteDeviceForm(form, settings) {
  if (!settings) return form;
  return {
    ...form,
    gpsEnabled: settings.gps_enabled,
    autoSyncOnEndRoute: settings.auto_sync_on_end_route,
    cameraEnabled: settings.camera_enabled,
    scanningTypes: settings.scanning_types,
  };
}

function fromServerConfig(cfg) {
  return {
    gpsEnabled: cfg.gps_enabled,
    autoSyncOnEndRoute: cfg.auto_sync_on_end_route,
    cameraEnabled: cfg.camera_enabled,
    scanningTypes: cfg.scanning_types,
    host: cfg.host,
    localHost: cfg.local_host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    uploadPath: cfg.upload_path,
    downloadPath: cfg.download_path,
  };
}

const SCANNING_TYPES = [
  { value: 'camera', label: 'Phone Camera' },
  { value: 'wedge', label: 'Wedge Scanner' },
  { value: 'qr', label: 'QR Code' },
  { value: 'nfc', label: 'NFC' },
  { value: 'manual', label: 'Manual' },
];

// PNG of a QR with a label under it (company, or company + site), downloaded.
function downloadLabeledQr(qrDataUrl, label, filename) {
  const img = new Image();
  img.onload = () => {
    const labelH = label ? 90 : 0;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height + labelH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    if (label) {
      let size = 44;
      ctx.font = `bold ${size}px sans-serif`;
      while (size > 18 && ctx.measureText(label).width > canvas.width - 40) {
        size -= 2;
        ctx.font = `bold ${size}px sans-serif`;
      }
      ctx.fillStyle = '#1a2332';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, canvas.width / 2, img.height + labelH / 2 - 10);
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  };
  img.src = qrDataUrl;
}

function buildPayload(form) {
  // The app only distinguishes 'camera' (its own scan screen) from 'wedge'
  // (an external scanner types into the same ready-and-waiting field a
  // human would use) for which UI it shows. 'wedge' only applies when it's
  // actually checked - QR/NFC/Manual selected without Wedge Scanner should
  // never show a "ready for wedge scanner" prompt for hardware that isn't
  // there. Camera takes precedence when both are checked (QR also reads
  // through the camera, so it lands here too); Enable Camera off always
  // forces wedge regardless of what's checked above. Whether hand-typing is
  // allowed at all is separate - see manualEntryEnabled below.
  const barcodeInputMode = !form.cameraEnabled
    ? 'wedge'
    : form.scanningTypes.includes('wedge') && !form.scanningTypes.includes('camera')
    ? 'wedge'
    : 'camera';
  return {
    gpsEnabled: form.gpsEnabled,
    autoSyncOnEndRoute: form.autoSyncOnEndRoute,
    cameraEnabled: form.cameraEnabled,
    barcodeInputMode,
    // Off means the operator can't hand-type a point ID - only a scan
    // (camera, wedge hardware, or NFC) is accepted at a checkpoint.
    manualEntryEnabled: form.scanningTypes.includes('manual'),
    ftpSettings: {
      // Same split as toServerConfig above: host/localHost are case-
      // insensitive hostnames/IPs, safe to normalize; user/password/the two
      // paths are real, case-sensitive FTP credentials and Unix-style paths
      // -- forcing those to caps could break a real login or directory.
      host: form.host.trim().toUpperCase(),
      localHost: form.localHost.trim().toUpperCase(),
      port: parseInt(form.port, 10) || 21,
      user: form.user.trim(),
      password: form.password,
      uploadPath: form.uploadPath.trim(),
      downloadPath: form.downloadPath.trim(),
    },
  };
}

export default function DeviceSetupCode() {
  const tenantLabel = localStorage.getItem('tenantLabel');
  const [form, setForm] = useState(loadSavedForm);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [unlockQrDataUrl, setUnlockQrDataUrl] = useState(null);
  const [unlockErr, setUnlockErr] = useState(null);
  const [err, setErr] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  // Per-site setup codes (built automatically; see the QR effect below).
  const [sites, setSites] = useState([]);
  const [siteLogins, setSiteLogins] = useState({});
  const [siteQrs, setSiteQrs] = useState({});
  const [siteStatus, setSiteStatus] = useState('idle'); // idle | saving | saved | error
  const [printSites, setPrintSites] = useState(false);
  // Set once the saved settings have loaded; gates auto-save (see below).
  const [loaded, setLoaded] = useState(false);
  const baselineRef = useRef(null);

  // The tenant this instance of the page loaded for, captured once at mount
  // -- compared against localStorage.tenant below to catch a login in
  // ANOTHER browser tab switching the active tenant out from under this one.
  // Without this, Generate QR Code would PUT this page's (now-stale, wrong-
  // tenant) form straight into whichever tenant the OTHER tab just logged
  // into, silently overwriting that tenant's real FTP credentials with
  // this one's -- confirmed happening for real, not just theoretical (see
  // the admin-reported "device setup codes not saving").
  const [mountTenant] = useState(() => localStorage.getItem('tenant') || '');
  const [tenantChangedElsewhere, setTenantChangedElsewhere] = useState(false);

  // The native "storage" event only fires in OTHER tabs/windows of the same
  // origin, never the tab that made the change itself -- exactly the signal
  // needed here, since a same-tab tenant switch already goes through a full
  // remount (a fresh login navigates to "/", unmounting this page) and
  // isn't a risk the way a second tab silently changing out from under this
  // one is.
  useEffect(() => {
    function handleStorage(e) {
      if (e.key === 'tenant' && e.newValue !== mountTenant) {
        setTenantChangedElsewhere(true);
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [mountTenant]);

  // The server (per-tenant, see app.device_setup) is now the source of
  // truth -- it's what makes "saved" mean anything beyond this one browser.
  // localStorage stays as a same-browser fallback: if this tenant hasn't
  // saved anything server-side yet (a first-ever visit, or before this
  // feature existed), whatever was already local carries forward instead of
  // resetting to the hardcoded demo defaults.
  useEffect(() => {
    getDeviceSetupConfig()
      .then(cfg => {
        if (cfg) {
          setForm(prev => ({ ...prev, ...fromServerConfig(cfg) }));
          if (cfg.site_logins) setSiteLogins(cfg.site_logins);
        }
        setLoaded(true);
      })
      // A failed load leaves `loaded` false on purpose: auto-save below must
      // never overwrite the server's settings with this browser's fallback.
      .catch(() => {});
  }, []);

  // Auto-save: every change to the settings or the per-site logins is saved
  // to the server a moment after the last keystroke, so nothing depends on
  // remembering to click Generate (and another browser sees the same
  // settings). The first state after a load is just the baseline, not a change.
  useEffect(() => {
    if (!loaded || tenantChangedElsewhere || !form.host.trim()) return undefined;
    const body = { ...toServerConfig(form), site_logins: storedSiteLogins(siteLogins) };
    const json = JSON.stringify(body);
    if (baselineRef.current === null) { baselineRef.current = json; return undefined; }
    if (json === baselineRef.current) return undefined;
    const timer = setTimeout(() => {
      setSaveStatus('saving');
      updateDeviceSetupConfig(body)
        .then(() => { baselineRef.current = json; setSaveStatus('saved'); })
        .catch(() => setSaveStatus('error'));
    }, 800);
    return () => clearTimeout(timer);
  }, [form, siteLogins, loaded, tenantChangedElsewhere]);

  // The codes always reflect the current settings: rebuilt whenever they
  // change and on every visit (they're only encoded text, nothing to store).
  useEffect(() => {
    if (!form.host.trim()) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const qr = text => QRCode.toDataURL(text, { width: 720, margin: 2 });
        const main = await qr(JSON.stringify(buildPayload(form)));
        const entries = await Promise.all(sites.map(async s => {
          const login = siteLogins[s.site_code] || {};
          const payload = buildPayload({ ...siteDeviceForm(form, login.settings), user: login.user?.trim() || form.user, password: login.password || form.password });
          return [s.site_code, await qr(JSON.stringify(payload))];
        }));
        if (!cancelled) { setQrDataUrl(main); setSiteQrs(Object.fromEntries(entries)); }
      } catch (ex) {
        if (!cancelled) setErr('Could not generate QR code: ' + ex.message);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form, sites, siteLogins]);

  // Keeps the form's values across leaving/returning to this page (and a
  // full reload) instead of resetting to the hardcoded demo defaults every
  // time -- an admin setting up several real devices in a row shouldn't
  // have to retype the same FTP host/credentials each visit.
  useEffect(() => {
    try {
      const tenant = localStorage.getItem('tenant') || '';
      localStorage.setItem(`${STORAGE_KEY_PREFIX}:${tenant}`, JSON.stringify(form));
    } catch {
      // Storage full/unavailable (private browsing, quota) -- not worth
      // surfacing an error for a convenience feature.
    }
  }, [form]);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaveStatus('idle');
  }

  function toggleScanningType(value) {
    setForm(prev => ({
      ...prev,
      scanningTypes: prev.scanningTypes.includes(value)
        ? prev.scanningTypes.filter(v => v !== value)
        : [...prev.scanningTypes, value],
    }));
    setSaveStatus('idle');
  }

  function generateQr() {
    setErr(null);
    if (tenantChangedElsewhere) {
      setErr('The active tenant changed in another tab. Reload this page before saving, so you don’t overwrite the wrong tenant’s settings.');
      return;
    }
    if (!form.host.trim()) {
      setErr('Remote Host is required.');
      return;
    }
    const payload = JSON.stringify(buildPayload(form));
    // 720px source, shown at 300px: stays crisp when saved or printed large.
    QRCode.toDataURL(payload, { width: 720, margin: 2 })
      .then(setQrDataUrl)
      .catch(ex => setErr('Could not generate QR code: ' + ex.message));

    // Saved per-tenant server-side every time a code is generated, so any
    // admin on any browser sees the same last-generated setup the next time
    // they open this page -- not just whoever's browser happened to type it.
    setSaveStatus('saving');
    updateDeviceSetupConfig(toServerConfig(form))
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('error'));
  }

  // Saves the QR as a PNG with the company name under it, matching what's
  // shown on screen.
  function saveQrImage() {
    if (!qrDataUrl) return;
    downloadLabeledQr(qrDataUrl, tenantLabel, `${localStorage.getItem('tenant') || 'tenant'}-device-setup-code.png`);
  }

  // ── Per-site setup codes ───────────────────────────────────────────────
  // A device "loads" a site by scanning a setup code whose FTP login (home
  // folder = that site's folder) is that site's own. Logins left blank fall
  // back to the tenant-wide one above.

  useEffect(() => {
    getSites()
      .then(list => setSites(list.filter(s => s.id !== 'Incidents1' && s.id !== 'PERSP00001').sort((a, b) => a.site_code.localeCompare(b.site_code))))
      .catch(() => {});
  }, []);

  function updateSiteLogin(code, key, value) {
    setSiteLogins(prev => ({ ...prev, [code]: { user: '', password: '', ...prev[code], [key]: value } }));
    setSiteStatus('idle');
  }

  // Ticking "custom settings" copies the tenant's current values in as the
  // starting point; unticking drops the override (back to the tenant's).
  function toggleSiteCustom(code, on) {
    updateSiteLogin(code, 'settings', on ? {
      gps_enabled: form.gpsEnabled,
      auto_sync_on_end_route: form.autoSyncOnEndRoute,
      camera_enabled: form.cameraEnabled,
      scanning_types: [...form.scanningTypes],
    } : null);
  }

  function updateSiteSetting(code, key, value) {
    setSiteLogins(prev => ({ ...prev, [code]: { ...prev[code], settings: { ...prev[code].settings, [key]: value } } }));
    setSiteStatus('idle');
  }

  function toggleSiteScanningType(code, value) {
    const current = siteLogins[code]?.settings?.scanning_types ?? [];
    updateSiteSetting(code, 'scanning_types', current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
  }

  // The codes themselves are built automatically (see the effect above);
  // this is the explicit "save now" for the per-site logins.
  function saveSiteLogins() {
    setErr(null);
    if (tenantChangedElsewhere) {
      setErr('The active tenant changed in another tab. Reload this page before saving, so you don’t overwrite the wrong tenant’s settings.');
      return;
    }
    setSiteStatus('saving');
    updateDeviceSetupConfig({ ...toServerConfig(form), site_logins: storedSiteLogins(siteLogins) })
      .then(() => setSiteStatus('saved'))
      .catch(() => setSiteStatus('error'));
  }

  // Prints just the site codes (the page's normal print is the single
  // tenant code): flag the page, let it re-render, print, then clear it.
  function printSiteCodes() {
    const prev = document.title;
    document.title = `Site Setup Codes - ${tenantLabel || localStorage.getItem('tenant') || ''}`;
    setPrintSites(true);
    const done = () => { setPrintSites(false); document.title = prev; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 100);
  }

  // Print dialog -> "Save as PDF". The tab title becomes the default PDF
  // filename, so set it for the duration of the dialog.
  function printCode() {
    const prev = document.title;
    document.title = `Device Setup Code - ${tenantLabel || localStorage.getItem('tenant') || ''}`;
    window.print();
    document.title = prev;
  }

  function generateUnlockQr() {
    setUnlockErr(null);
    const payload = JSON.stringify({ unlockEdit: true, token: EDIT_UNLOCK_TOKEN });
    QRCode.toDataURL(payload, { width: 360, margin: 2 })
      .then(setUnlockQrDataUrl)
      .catch(ex => setUnlockErr('Could not generate QR code: ' + ex.message));
  }

  return (
    <div className={`${styles.page} ${printSites ? styles.printSites : ''}`}>
      <h2 className={styles.heading}>Device Setup Code</h2>
      <p className={`${styles.subheading} ${styles.noPrint}`}>
        Generates a QR code that configures a FlexPatrol Mobile device in one scan — FTP server details plus the GPS, camera, and barcode-scanning settings. The app has no manual settings screen; this is the only way to configure a device.
      </p>

      {tenantChangedElsewhere && (
        <div className={`${styles.formErr} ${styles.noPrint}`} style={{ marginBottom: 16 }}>
          You signed into a different tenant in another tab. Saving here is disabled until you{' '}
          <button type="button" onClick={() => window.location.reload()} style={{ textDecoration: 'underline', border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}>
            reload this page
          </button>.
        </div>
      )}

      <div className={`${styles.layout} ${styles.mainCodeArea}`}>
        <div className={`${styles.form} ${styles.noPrint}`}>
          {err && <div className={styles.formErr}>{err}</div>}

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Remote Host (WAN)</label>
            <input className={styles.formInput} value={form.host} onChange={e => updateField('host', e.target.value)} placeholder="ftp.yourcompany.com" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Local Host (LAN)</label>
            <input className={styles.formInput} value={form.localHost} onChange={e => updateField('localHost', e.target.value)} placeholder="192.168.1.100" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Port</label>
            <input className={styles.formInput} value={form.port} onChange={e => updateField('port', e.target.value)} placeholder="21" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Username</label>
            <input className={`${styles.formInput} ${styles.caseSensitiveInput}`} value={form.user} onChange={e => updateField('user', e.target.value)} placeholder="ftpuser" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Password</label>
            <input type="password" className={styles.formInput} value={form.password} onChange={e => updateField('password', e.target.value)} placeholder="••••••••" />
            {sites.length > 1 && (
              <p className={styles.formHint}>
                This is the default login. To give a site its own FTP login,{' '}
                <a href="#site-setup-codes" onClick={e => { e.preventDefault(); document.getElementById('site-setup-codes')?.scrollIntoView({ behavior: 'smooth' }); }}>
                  set it per site below ↓
                </a>
              </p>
            )}
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Upload Path</label>
            <input className={`${styles.formInput} ${styles.caseSensitiveInput}`} value={form.uploadPath} onChange={e => updateField('uploadPath', e.target.value)} />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Download Path</label>
            <input className={`${styles.formInput} ${styles.caseSensitiveInput}`} value={form.downloadPath} onChange={e => updateField('downloadPath', e.target.value)} />
          </div>

          <div className={styles.formRow}>
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={form.gpsEnabled} onChange={e => updateField('gpsEnabled', e.target.checked)} />
              GPS Checkpoint Tagging
            </label>
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={form.autoSyncOnEndRoute} onChange={e => updateField('autoSyncOnEndRoute', e.target.checked)} />
              Auto-Sync at End of Route
            </label>
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={form.cameraEnabled} onChange={e => updateField('cameraEnabled', e.target.checked)} />
              Enable Camera
            </label>
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Scanning Type</label>
            <div className={styles.toggleGroup}>
              {SCANNING_TYPES.map(({ value, label }) => (
                <label className={styles.toggleLabel} key={value}>
                  <input
                    type="checkbox"
                    checked={form.scanningTypes.includes(value)}
                    onChange={() => toggleScanningType(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className={styles.formHint}>
              Which methods this device accepts for reading a checkpoint. NFC checkpoint tags are written separately, in the field — not from this page.
            </p>
          </div>

          <div className={styles.formActions}>
            <button className={styles.saveBtn} onClick={generateQr}>Generate QR Code</button>
            {saveStatus === 'saving' && <span className={styles.formHint}>Saving…</span>}
            {saveStatus === 'saved' && <span className={styles.saveOkNote}>✓ Saved for this tenant</span>}
            {saveStatus === 'error' && <span className={styles.formErr}>Could not save — the code above still works, but won't be there next visit.</span>}
          </div>
          <p className={styles.formHint}>
            The FTP password is embedded in the generated code as plain text — treat a printed or displayed code the same as you would the password itself.
          </p>
        </div>

        <div className={styles.qrPanel}>
          {qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="Device setup QR code" className={styles.qrImage} />
              {tenantLabel && <p className={styles.qrCompanyName}>{tenantLabel}</p>}
              <p className={styles.formHint}>Scan with FlexPatrol Mobile's "Scan Setup Code" button on the Main screen.</p>
              <p className={styles.printOnly}>This code contains the FTP login — keep it secure.</p>
              <div className={`${styles.qrActions} ${styles.noPrint}`}>
                <button className={styles.saveBtn} onClick={saveQrImage}>Save QR Image</button>
                <button className={styles.printBtn} onClick={printCode}>Print / Save as PDF</button>
              </div>
            </>
          ) : (
            <p className={styles.qrPlaceholder}>Fill in the form and click Generate to preview the code here.</p>
          )}
        </div>
      </div>

      <div className={styles.siteSection} id="site-setup-codes">
        <h2 className={`${styles.heading} ${styles.siteHeading}`} style={{ marginTop: 32 }}>Site Setup Codes</h2>
        <p className={`${styles.subheading} ${styles.noPrint}`}>
          One code per site, to load that site on a device: it carries the connection settings above with the site's own FTP login
          (the login whose home folder is that site's folder). A site left blank uses the login above.
        </p>
        <div className={`${styles.formActions} ${styles.noPrint}`}>
          <button className={styles.saveBtn} onClick={saveSiteLogins} disabled={sites.length === 0}>Save Site Logins</button>
          {Object.keys(siteQrs).length > 0 && (
            <button className={styles.printBtn} onClick={printSiteCodes}>Print / Save as PDF</button>
          )}
          {siteStatus === 'saving' && <span className={styles.formHint}>Saving…</span>}
          {siteStatus === 'saved' && <span className={styles.saveOkNote}>✓ Site logins saved for this tenant</span>}
          {siteStatus === 'error' && <span className={styles.formErr}>Could not save the site logins.</span>}
        </div>
        <div className={styles.siteGrid}>
          {sites.map(s => {
            const login = siteLogins[s.site_code] || {};
            const qr = siteQrs[s.site_code];
            return (
              <div className={styles.siteCard} key={s.site_code}>
                <div className={styles.siteCardTitle}>{s.name} <span className={styles.siteCardCode}>{s.site_code}</span></div>
                <div className={styles.noPrint}>
                  <input className={`${styles.formInput} ${styles.caseSensitiveInput}`} style={{ marginBottom: 6, width: '100%' }}
                    value={login.user ?? ''} placeholder={`FTP username (blank = ${form.user || 'tenant login'})`}
                    onChange={e => updateSiteLogin(s.site_code, 'user', e.target.value)} />
                  <input type="password" className={styles.formInput} style={{ marginBottom: 8, width: '100%' }}
                    value={login.password ?? ''} placeholder="FTP password (blank = tenant password)"
                    onChange={e => updateSiteLogin(s.site_code, 'password', e.target.value)} />
                  <label className={styles.toggleLabel} style={{ marginBottom: 4 }}>
                    <input type="checkbox" checked={!!login.settings} onChange={e => toggleSiteCustom(s.site_code, e.target.checked)} />
                    Custom camera / scanning settings
                  </label>
                  {login.settings ? (
                    <div className={styles.siteSettings}>
                      <label className={styles.toggleLabel}>
                        <input type="checkbox" checked={login.settings.gps_enabled} onChange={e => updateSiteSetting(s.site_code, 'gps_enabled', e.target.checked)} />
                        GPS Checkpoint Tagging
                      </label>
                      <label className={styles.toggleLabel}>
                        <input type="checkbox" checked={login.settings.auto_sync_on_end_route} onChange={e => updateSiteSetting(s.site_code, 'auto_sync_on_end_route', e.target.checked)} />
                        Auto-Sync at End of Route
                      </label>
                      <label className={styles.toggleLabel}>
                        <input type="checkbox" checked={login.settings.camera_enabled} onChange={e => updateSiteSetting(s.site_code, 'camera_enabled', e.target.checked)} />
                        Enable Camera
                      </label>
                      <div className={styles.formHint} style={{ marginTop: 6 }}>Scanning type</div>
                      {SCANNING_TYPES.map(({ value, label }) => (
                        <label className={styles.toggleLabel} key={value}>
                          <input type="checkbox" checked={login.settings.scanning_types.includes(value)} onChange={() => toggleSiteScanningType(s.site_code, value)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.formHint} style={{ marginBottom: 6 }}>Using the tenant-wide settings above.</div>
                  )}
                </div>
                {qr ? (
                  <>
                    <img src={qr} alt={`Setup QR code for ${s.name}`} className={styles.siteQr} />
                    <div className={styles.siteCardLabel}>{[tenantLabel, s.name].filter(Boolean).join(' — ')}</div>
                    <p className={styles.printOnly}>This code contains the FTP login — keep it secure.</p>
                    <button className={`${styles.toolBtn} ${styles.noPrint}`} onClick={() =>
                      downloadLabeledQr(qr, [tenantLabel, s.name].filter(Boolean).join(' — '), `${localStorage.getItem('tenant') || 'tenant'}-${s.site_code}-setup-code.png`)}>
                      Save PNG
                    </button>
                  </>
                ) : (
                  <div className={`${styles.formHint} ${styles.noPrint}`}>Building this site's code…</div>
                )}
              </div>
            );
          })}
          {sites.length === 0 && <div className={styles.formHint}>No sites to show yet.</div>}
        </div>
      </div>

      <div className={styles.noPrint}>
      <h2 className={styles.heading} style={{ marginTop: 32 }}>Edit-Unlock Code</h2>
      <p className={styles.subheading}>
        A device's FTP settings are normally read-only on-screen -- this generates the separate QR code that unlocks the "EDIT" button on the Device Setup screen for that visit only. Anyone who scans it can change that device's FTP host/credentials on the spot, so treat it with the same care as an admin password.
      </p>
      <div className={styles.layout}>
        <div className={styles.form}>
          {unlockErr && <div className={styles.formErr}>{unlockErr}</div>}
          <div className={styles.formActions}>
            <button className={styles.unlockBtn} onClick={generateUnlockQr}>Generate Edit-Unlock Code</button>
          </div>
          <p className={styles.formHint}>
            Not device- or tenant-specific -- this same code unlocks editing on any FlexPatrol Mobile device on any tenant. It doesn't change any settings by itself; it only unlocks the on-device form.
          </p>
        </div>

        <div className={styles.qrPanel}>
          {unlockQrDataUrl ? (
            <>
              <img src={unlockQrDataUrl} alt="Edit-unlock QR code" className={styles.qrImage} />
              <p className={styles.formHint}>Scan with the "EDIT (requires unlock code)" button on the device's Setup screen.</p>
            </>
          ) : (
            <p className={styles.qrPlaceholder}>Click Generate to preview the edit-unlock code here.</p>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
