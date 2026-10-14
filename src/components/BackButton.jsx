import { useNavigate } from 'react-router-dom';
import styles from './BackButton.module.css';

// The standard Back control: "← <where it goes>", top-left of the screen.
// Layout renders it for every screen in navigation.js; screens whose parent
// is only known once they've loaded render it themselves.
export default function BackButton({ to, label }) {
  const navigate = useNavigate();
  return (
    <div className={styles.bar}>
      <button type="button" className={styles.btn} onClick={() => navigate(to)}>
        ← {label}
      </button>
    </div>
  );
}
