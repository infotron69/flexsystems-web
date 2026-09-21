import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { login, getTenant } from '../api/client';
import logo from '../assets/flexsystems-logo.png';
import styles from './Login.module.css';

export default function Login() {
  const { tenant } = useParams();
  const [tenantLabel, setTenantLabel] = useState(null);
  const [tenantError, setTenantError] = useState(false);
  const [userCode, setUserCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!tenant) return;
    getTenant(tenant)
      .then(t => setTenantLabel(t.label))
      .catch(() => setTenantError(true));
  }, [tenant]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = await login(tenant, userCode, password);
      localStorage.setItem('token', token);
      localStorage.setItem('tenant', tenant);
      localStorage.setItem('tenantLabel', tenantLabel || '');
      navigate('/');
    } catch (err) {
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  }

  // No customer specified in the URL, or the slug doesn't match a known
  // customer — never show a picker/list here, since the whole point is
  // that customers only ever see their own private login link.
  if (!tenant || tenantError) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <img src={logo} alt="FlexSystems" className={styles.logoImg} />
          </div>
          <p style={{ textAlign: 'center', color: '#556', fontSize: '0.9rem' }}>
            Please use the login link provided by FlexSystems for your account.
          </p>
        </div>
      </div>
    );
  }

  if (tenantLabel === null) {
    return <div className={styles.page}><div className={styles.card} /></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <img src={logo} alt="FlexSystems" className={styles.logoImg} />
        </div>
        <p style={{ textAlign: 'center', color: '#556', fontSize: '0.85rem', marginTop: -8, marginBottom: 16 }}>
          {tenantLabel}
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.error}>{error}</div>}

          <label className={styles.label}>
            User Code
            <input
              className={styles.input}
              type="text"
              value={userCode}
              onChange={e => setUserCode(e.target.value.toUpperCase())}
              autoFocus
              autoComplete="username"
              required
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button className={styles.button} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
