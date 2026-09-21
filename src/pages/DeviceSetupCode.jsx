import { useState } from 'react';
import QRCode from 'qrcode';
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

const SCANNING_TYPES = [
  { value: 'camera', label: 'Phone Camera' },
  { value: 'wedge', label: 'Wedge Scanner' },
  { value: 'qr', label: 'QR Code' },
  { value: 'nfc', label: 'NFC' },
  { value: 'manual', label: 'Manual' },
];

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
      host: form.host.trim(),
      localHost: form.localHost.trim(),
      port: parseInt(form.port, 10) || 21,
      user: form.user.trim(),
      password: form.password,
      uploadPath: form.uploadPath.trim(),
      downloadPath: form.downloadPath.trim(),
    },
  };
}

export default function DeviceSetupCode() {
  const [form, setForm] = useState(emptyForm);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [unlockQrDataUrl, setUnlockQrDataUrl] = useState(null);
  const [unlockErr, setUnlockErr] = useState(null);
  const [err, setErr] = useState(null);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setQrDataUrl(null);
  }

  function toggleScanningType(value) {
    setForm(prev => ({
      ...prev,
      scanningTypes: prev.scanningTypes.includes(value)
        ? prev.scanningTypes.filter(v => v !== value)
        : [...prev.scanningTypes, value],
    }));
    setQrDataUrl(null);
  }

  function generateQr() {
    setErr(null);
    if (!form.host.trim()) {
      setErr('Remote Host is required.');
      return;
    }
    const payload = JSON.stringify(buildPayload(form));
    QRCode.toDataURL(payload, { width: 360, margin: 2 })
      .then(setQrDataUrl)
      .catch(ex => setErr('Could not generate QR code: ' + ex.message));
  }

  function generateUnlockQr() {
    setUnlockErr(null);
    const payload = JSON.stringify({ unlockEdit: true, token: EDIT_UNLOCK_TOKEN });
    QRCode.toDataURL(payload, { width: 360, margin: 2 })
      .then(setUnlockQrDataUrl)
      .catch(ex => setUnlockErr('Could not generate QR code: ' + ex.message));
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Device Setup Code</h2>
      <p className={styles.subheading}>
        Generates a QR code that configures a FlexPatrol Mobile device in one scan — FTP server details plus the GPS, camera, and barcode-scanning settings. The app has no manual settings screen; this is the only way to configure a device.
      </p>

      <div className={styles.layout}>
        <div className={styles.form}>
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
            <input className={styles.formInput} value={form.user} onChange={e => updateField('user', e.target.value)} placeholder="ftpuser" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Password</label>
            <input type="password" className={styles.formInput} value={form.password} onChange={e => updateField('password', e.target.value)} placeholder="••••••••" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Upload Path</label>
            <input className={styles.formInput} value={form.uploadPath} onChange={e => updateField('uploadPath', e.target.value)} />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Download Path</label>
            <input className={styles.formInput} value={form.downloadPath} onChange={e => updateField('downloadPath', e.target.value)} />
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
          </div>
          <p className={styles.formHint}>
            The FTP password is embedded in the generated code as plain text — treat a printed or displayed code the same as you would the password itself.
          </p>
        </div>

        <div className={styles.qrPanel}>
          {qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="Device setup QR code" className={styles.qrImage} />
              <p className={styles.formHint}>Scan with FlexPatrol Mobile's "Scan Setup Code" button on the Main screen.</p>
            </>
          ) : (
            <p className={styles.qrPlaceholder}>Fill in the form and click Generate to preview the code here.</p>
          )}
        </div>
      </div>

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
  );
}
