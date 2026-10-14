import logo from '../assets/flexsystems-logo.png';
import styles from '../pages/Report.module.css';

// Back lives in the screen-level BackButton (see navigation.js), not here.
export default function ReportHeader({ title, subtitle, onExport, onBeforePrint }) {
  // The logged-in tenant's company name -- what the Dashboard shows beside
  // its title -- so every report, printed or saved as PDF, says whose data it is.
  const customerName = localStorage.getItem('tenantLabel');

  async function handlePrint() {
    // onBeforePrint may return a promise (e.g. a large report staggering its
    // expand-all across frames so the browser stays responsive) -- wait for
    // it before printing, not just for the next paint.
    await onBeforePrint?.();
    requestAnimationFrame(() => window.print());
  }

  return (
    <div className={styles.header}>
      <div className={styles.headingBlock}>
        <div className={styles.headingRow}>
          <img src={logo} alt="FlexSystems" className={styles.reportLogo} />
          <h2 className={styles.heading}>{title}</h2>
        </div>
        {customerName && <span className={styles.customerName}>{customerName}</span>}
        <span className={styles.subheading}>{subtitle}</span>
      </div>
      <div className={styles.headerActions}>
        {onExport && <button className={styles.exportBtn} onClick={onExport}>Export CSV</button>}
        <button className={styles.printBtn} onClick={handlePrint}>Print</button>
      </div>
    </div>
  );
}
