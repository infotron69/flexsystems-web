import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { createCheckoutSession } from '../api/client';
import { PLANS, findPlan, perScan } from '../billing/plans';
import logo from '../assets/flexsystems-logo.png';
import styles from './Signup.module.css';

// Public FlexPatrol sign-up. Pick a monthly plan, give a company + work
// email, and we hand off to Stripe-hosted Checkout (card details never touch
// our servers). Deep-linkable from the Pricing page: /signup?plan=growth
const TEST_MODE = import.meta.env.VITE_STRIPE_MODE !== 'live';

export default function Signup() {
  const [params] = useSearchParams();
  const [planId, setPlanId]   = useState(findPlan(params.get('plan'))?.id || 'standard');
  const [company, setCompany] = useState('');
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const plan = findPlan(planId);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { url } = await createCheckoutSession({
        plan: planId, company: company.trim(), name: name.trim(), email: email.trim(),
      });
      window.location.assign(url);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not start checkout. Please try again or contact sales.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      {TEST_MODE && (
        <div className={styles.testBanner}>
          Test mode — no real charges. Use card 4242 4242 4242 4242, any future date, any CVC.
        </div>
      )}

      <header className={styles.header}>
        <a href="https://flexsystems.net/pricing/"><img src={logo} alt="FlexSystems" className={styles.logo} /></a>
        <a href="https://flexsystems.net/pricing/" className={styles.back}>← Back to pricing</a>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Start your FlexPatrol plan</h1>
        <p className={styles.sub}>Billed monthly. Cancel anytime. Need more than 40,000 scans? <a href="https://flexsystems.net/contact-us/">Talk to sales</a>.</p>

        <form onSubmit={handleSubmit} className={styles.layout}>
          <fieldset className={styles.plans}>
            <legend className={styles.sectionLabel}>1. Choose a plan</legend>
            {PLANS.map(p => (
              <label key={p.id} className={`${styles.plan} ${p.id === planId ? styles.planOn : ''}`}>
                <input type="radio" name="plan" value={p.id} checked={p.id === planId}
                       onChange={() => setPlanId(p.id)} className={styles.radio} />
                <span className={styles.planName}>
                  {p.name}{p.popular && <span className={styles.badge}>Most popular</span>}
                </span>
                <span className={styles.planScans}>Up to {p.scans.toLocaleString()} scans/mo · ~{perScan(p)}/scan</span>
                <span className={styles.planPrice}>${p.price}<small>/mo</small></span>
              </label>
            ))}
          </fieldset>

          <section className={styles.details}>
            <div className={styles.sectionLabel}>2. Your details</div>
            {error && <div className={styles.error}>{error}</div>}

            <label className={styles.label}>Company or site name
              <input className={styles.input} value={company} onChange={e => setCompany(e.target.value)}
                     autoComplete="organization" maxLength={120} required />
            </label>
            <label className={styles.label}>Your name
              <input className={styles.input} value={name} onChange={e => setName(e.target.value)}
                     autoComplete="name" maxLength={120} required />
            </label>
            <label className={styles.label}>Work email
              <input className={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)}
                     autoComplete="email" maxLength={200} required />
            </label>

            <div className={styles.summary}>
              <span>{plan.name} plan</span>
              <strong>${plan.price}/month</strong>
            </div>
            <p className={styles.fine}>
              Unused scans don't roll over. Top-up credits are available any month if you run over.
            </p>

            <button className={styles.button} disabled={loading}>
              {loading ? 'Opening secure checkout…' : 'Continue to payment'}
            </button>
            <p className={styles.secure}>Payment is handled securely by Stripe.</p>
          </section>
        </form>
      </main>
    </div>
  );
}

export function SignupResult({ ok }) {
  const [params] = useSearchParams();
  const plan = findPlan(params.get('plan'));
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a href="https://flexsystems.net/"><img src={logo} alt="FlexSystems" className={styles.logo} /></a>
      </header>
      <main className={`${styles.main} ${styles.result}`}>
        {ok ? (
          <>
            <h1 className={styles.title}>You're signed up{plan ? ` for ${plan.name}` : ''}</h1>
            <p className={styles.sub}>
              Thanks — your payment went through and a receipt is on its way from Stripe.
              We'll email your FlexPatrol login link and setup steps within one business day.
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Checkout cancelled</h1>
            <p className={styles.sub}>No charge was made. You can pick up where you left off any time.</p>
            <Link className={styles.button} to={`/signup${plan ? `?plan=${plan.id}` : ''}`}>Back to sign-up</Link>
          </>
        )}
      </main>
    </div>
  );
}
