"""Create the five FlexPatrol monthly plans in Stripe TEST mode (safe to re-run).

    set STRIPE_SECRET_KEY=sk_test_...
    python scripts/stripe_seed_test.py

Each plan gets one Product and one monthly USD Price with lookup key
flexpatrol_<plan>_monthly, which app/routers/billing.py looks up at checkout.
Refuses to run with a live key.
"""
import os
import sys

import stripe

PLANS = [  # id, name, monthly USD, scans/month
    ("basic",    "Basic",    50,  800),
    ("starter",  "Starter",  99,  2000),
    ("standard", "Standard", 199, 5000),
    ("growth",   "Growth",   449, 15000),
    ("scale",    "Scale",    999, 40000),
]

key = os.environ.get("STRIPE_SECRET_KEY", "")
if not key.startswith(("sk_test_", "rk_test_")):
    sys.exit("STRIPE_SECRET_KEY must be a TEST key (sk_test_...). Nothing was created.")
stripe.api_key = key

for pid, name, usd, scans in PLANS:
    lk = f"flexpatrol_{pid}_monthly"
    existing = stripe.Price.list(lookup_keys=[lk], active=True, limit=1).data
    if existing:
        p = existing[0]
        ok = p.unit_amount == usd * 100 and p.recurring and p.recurring.interval == "month"
        print(f"{'ok  ' if ok else 'DIFF'} {lk:32} {p.id}  ${p.unit_amount / 100:.0f}/{p.recurring.interval}"
              + ("" if ok else f"  <-- expected ${usd}/month; archive it in Stripe and re-run"))
        continue
    product = stripe.Product.create(
        name=f"FlexPatrol {name}",
        description=f"Up to {scans:,} scans per month. Billed monthly.",
        metadata={"plan": pid, "scans_per_month": str(scans)},
    )
    price = stripe.Price.create(
        product=product.id, currency="usd", unit_amount=usd * 100,
        recurring={"interval": "month"}, lookup_key=lk, nickname=f"{name} monthly",
        metadata={"plan": pid, "scans_per_month": str(scans)},
    )
    print(f"new  {lk:32} {price.id}  ${usd}/month")
