// FlexPatrol self-serve plans — mirrors the flexsystems.net Pricing page.
// `id` is what the sign-up page sends to the backend; the backend maps it to
// a Stripe Price via lookup key (flexpatrol_<id>_monthly), so prices are
// never trusted from the browser. Change a price in Stripe + here + on the
// Pricing page together.
export const PLANS = [
  { id: 'basic',    name: 'Basic',    price: 50,  scans: 800 },
  { id: 'starter',  name: 'Starter',  price: 99,  scans: 2000 },
  { id: 'standard', name: 'Standard', price: 199, scans: 5000, popular: true },
  { id: 'growth',   name: 'Growth',   price: 449, scans: 15000 },
  { id: 'scale',    name: 'Scale',    price: 999, scans: 40000 },
];

export const findPlan = (id) => PLANS.find(p => p.id === String(id || '').toLowerCase());

export const perScan = (p) => `$${(p.price / p.scans).toFixed(4).replace(/0+$/, '')}`;
