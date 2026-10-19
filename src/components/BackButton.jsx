import useGoBack from '../hooks/useGoBack';
import styles from './BackButton.module.css';

// The standard Back control, top-left of the screen: returns to the page you
// came from, or to `fallback` (this screen's parent) if there isn't one.
// Layout renders it for every screen in navigation.js; screens whose parent
// is only known once they've loaded render it themselves.
export default function BackButton({ fallback }) {
  const goBack = useGoBack(fallback);
  return (
    <div className={styles.bar}>
      <button type="button" className={styles.btn} onClick={goBack}>
        ← Back
      </button>
    </div>
  );
}
