# FlexPatrol sign-up — Stripe backend (test mode)

The `/signup` page in this repo posts to `/api/billing/checkout-session`. These
files go into the FastAPI backend (the `app/` project that serves `/api`).

## Setup (test mode)

1. `pip install stripe` in the backend's environment.
2. Copy `app/routers/billing.py` into the backend's `app/routers/`, then in `app/main.py`:
   ```python
   from app.routers import billing
   app.include_router(billing.router, prefix="/api")
   ```
   Both endpoints are public (no login), like `/api/auth/tenants`.
3. Set environment variables on the backend:
   - `STRIPE_SECRET_KEY=sk_test_...` (Stripe Dashboard → Developers → API keys, with **Test mode** on)
   - `SIGNUP_BASE_URL=https://flexpatrol.flexsystems.net` (or `http://localhost:5173` in dev)
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (see step 5)
4. Create the five plans in Stripe test mode (safe to re-run; refuses live keys):
   `python scripts/stripe_seed_test.py`
5. Webhook: in Stripe (test mode) add an endpoint `https://flexpatrol.flexsystems.net/api/billing/webhook`
   for `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted` and `invoice.payment_failed`, then copy its signing secret.
   For local dev: `stripe listen --forward-to localhost:8010/api/billing/webhook`.
6. Test: open `/signup?plan=basic` and pay with `4242 4242 4242 4242`. For a decline, try `4000 0000 0000 0002`.

## Going live later

Live keys are refused until `STRIPE_ALLOW_LIVE=1` is set. To switch, create the
live prices with the same lookup keys (the seed script only runs with test keys),
swap in the live `sk_live_` and `whsec_` values, set `STRIPE_ALLOW_LIVE=1`, and build the
frontend with `VITE_STRIPE_MODE=live` to hide the test-mode banner.

## Not done yet

New sign-ups are logged (`NEW SIGNUP ...`), not provisioned. `on_new_subscription()`
is the hook for creating the tenant and emailing the login link.
