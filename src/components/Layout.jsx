import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getMe, generateAllPda } from '../api/client';
import usePdaFilesDirty from '../hooks/usePdaFilesDirty';
import useScrollRestoration from '../hooks/useScrollRestoration';
import { clearPdaFilesDirty } from '../pdaDirty';
import { getBackFallback } from '../navigation';
import BackButton from './BackButton';
import logo from '../assets/flexsystems-logo.png';
import styles from './Layout.module.css';

const NAV = [
  { to: '/',             label: 'Dashboard',    icon: '📊', end: true },
  { to: '/setup',        label: 'Setup',        icon: '⚙️' },
  { to: '/reports',      label: 'Reports',      icon: '📈' },
  { to: '/transactions', label: 'Transactions', icon: '📋' },
];

// __BUILD_TIME__ is injected by vite.config.js at build time -- a fresh
// value every build, so it's obvious at a glance whether a browser is
// showing the current deploy or a stale cached bundle.
const BUILD_LABEL = new Date(__BUILD_TIME__).toLocaleString(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const backFallback = getBackFallback(location.pathname);
  const [me, setMe] = useState(null);
  const tenantLabel = localStorage.getItem('tenantLabel');

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe(null));
  }, []);

  // Offer to regenerate the PDA upload files the moment the admin backs out
  // of a Setup screen with unsent-to-PDA changes pending (any
  // setup page that edits routes/points/questions/incidents/operators calls
  // markPdaFilesDirty() after a successful save) -- catches it right when
  // they're done, rather than relying on them remembering to visit Update
  // PDA Files separately later.
  const dirty = usePdaFilesDirty();
  const [showPdaOffer, setShowPdaOffer] = useState(false);
  const [pdaBusy, setPdaBusy] = useState(false);
  const [pdaResult, setPdaResult] = useState(null);
  const prevPathRef = useRef(location.pathname);

  // <main> (below) is the one scrollable container for every page in the
  // app -- restoring its position here, once, covers every list/report
  // page's "back to the top" problem instead of wiring it into each page.
  const mainRef = useRef(null);
  useScrollRestoration(mainRef);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    prevPathRef.current = location.pathname;
    // Offer whenever you back out of a Setup screen with unsent changes --
    // Back, a link, or leaving Setup altogether -- not only when leaving
    // Setup entirely. Not from or to the Update PDA Files page, which is
    // where you'd regenerate them anyway.
    const wasInSetup = prevPath.startsWith('/setup');
    const involvesPdaPage = prevPath.startsWith('/setup/pda') || location.pathname.startsWith('/setup/pda');
    if (wasInSetup && !involvesPdaPage && prevPath !== location.pathname && dirty) {
      setShowPdaOffer(true);
      setPdaResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function dismissPdaOffer() {
    setShowPdaOffer(false);
    clearPdaFilesDirty();
  }

  async function updatePdaFilesNow() {
    setPdaBusy(true);
    setPdaResult(null);
    try {
      const data = await generateAllPda();
      const results = data.results ?? [];
      const okCount = results.filter(r => r.success).length;
      setPdaResult({ ok: okCount === results.length, text: `${okCount} / ${results.length} site(s) updated` });
      clearPdaFilesDirty();
    } catch (ex) {
      setPdaResult({ ok: false, text: ex.response?.data?.detail ?? ex.message ?? 'Update failed' });
    } finally {
      setPdaBusy(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    const tenant = localStorage.getItem('tenant');
    navigate(tenant ? `/login/${tenant}` : '/login');
  }

  function accessSummary() {
    if (!me) return null;
    if (me.site_access.length === 0) return 'All Companies';
    const editCount = me.site_access.filter(a => a.can_edit).length;
    if (editCount === 0) return `${me.site_access.length} site${me.site_access.length === 1 ? '' : 's'} (view only)`;
    if (editCount === me.site_access.length) return `${me.site_access.length} site${me.site_access.length === 1 ? '' : 's'}`;
    return `${me.site_access.length} sites (${editCount} editable)`;
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src={logo} alt="FlexSystems" className={styles.brandLogo} />
        </div>
        <nav className={styles.nav}>
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [styles.link, isActive ? styles.active : ''].join(' ')
              }
            >
              <span className={styles.icon}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        {me && (
          <div className={styles.whoami}>
            <div className={styles.whoamiUser}>{me.user_code}</div>
            <div className={styles.whoamiMeta}>{tenantLabel && `${tenantLabel} · `}{accessSummary()}</div>
          </div>
        )}
        <button className={styles.logout} onClick={handleLogout}>
          Sign Out
        </button>
        <div className={styles.copyright}>© FlexSystems 2026</div>
        <div className={styles.buildVersion} title="When this build was deployed -- confirms you're not looking at a cached older version">
          Build {BUILD_LABEL}
        </div>
        <div className={styles.screenRef} title="Current screen path -- handy to quote when reporting an issue">
          {location.pathname}
        </div>
      </aside>

      <main ref={mainRef} className={styles.main}>
        {showPdaOffer && (
          <div className={styles.pdaOffer}>
            <span className={styles.pdaOfferText}>
              {pdaResult
                ? (pdaResult.ok ? `✓ PDA files updated — ${pdaResult.text}` : `⚠ ${pdaResult.text}`)
                : 'You made changes in Setup — update the PDA files so devices pick them up?'}
            </span>
            <div className={styles.pdaOfferActions}>
              {!pdaResult && (
                <button className={styles.pdaOfferBtn} onClick={updatePdaFilesNow} disabled={pdaBusy}>
                  {pdaBusy ? 'Updating…' : 'Update Now'}
                </button>
              )}
              {!pdaResult && (
                <button className={styles.pdaOfferLink} onClick={() => { setShowPdaOffer(false); navigate('/setup/pda'); }}>
                  Review First →
                </button>
              )}
              <button className={styles.pdaOfferDismiss} onClick={dismissPdaOffer}>
                {pdaResult ? 'Dismiss' : 'Not Now'}
              </button>
            </div>
          </div>
        )}
        {backFallback && <BackButton fallback={backFallback} />}
        <Outlet />
      </main>
    </div>
  );
}
