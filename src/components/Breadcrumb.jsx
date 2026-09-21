import { Link } from 'react-router-dom';
import styles from './Breadcrumb.module.css';

export default function Breadcrumb({ crumbs }) {
  return (
    <nav className={styles.nav}>
      {crumbs.map((c, i) => (
        <span key={i} className={styles.item}>
          {i > 0 && <span className={styles.sep}>/</span>}
          {c.to ? (
            <Link to={c.to} className={styles.link}>{c.label}</Link>
          ) : (
            <span className={styles.current}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
