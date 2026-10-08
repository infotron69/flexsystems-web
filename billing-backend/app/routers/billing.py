"""FlexPatrol self-serve billing: Stripe Checkout for the monthly plans.

Public endpoints (no login) used by the /signup page in flexsystems-web:

    POST /api/billing/checkout-session   -> {"url": "<Stripe-hosted checkout>"}
    POST /api/billing/webhook            <- Stripe events (signature-verified)

Prices are NOT taken from the browser. The page sends a plan id; we resolve it
to a Stripe Price by lookup key (flexpatrol_<plan>_monthly), created once by
scripts/stripe_seed_test.py.

Environment:
    STRIPE_SECRET_KEY      sk_test_...  (sk_live_ refused unless STRIPE_ALLOW_LIVE=1)
    STRIPE_WEBHOOK_SECRET  whsec_...    (from the Stripe dashboard or `stripe listen`)
    SIGNUP_BASE_URL        e.g. https://flexpatrol.flexsystems.net  (where /signup is served)
    STRIPE_ALLOW_LIVE      set to 1 only when you deliberately switch to live mode

Wire up in app/main.py next to the other routers:
    from app.routers import billing
    app.include_router(billing.router, prefix="/api")
"""
import json
import logging
import os
import re

import stripe
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

log = logging.getLogger("flexpatrol.billing")
router = APIRouter(prefix="/billing", tags=["billing"])

PLANS = {  # plan id -> (display name, monthly USD, scans/month). Keep in sync with src/billing/plans.js
    "basic":    ("Basic",    50,  800),
    "starter":  ("Starter",  99,  2000),
    "standard": ("Standard", 199, 5000),
    "growth":   ("Growth",   449, 15000),
    "scale":    ("Scale",    999, 40000),
}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_price_cache: dict[str, str] = {}


def lookup_key(plan: str) -> str:
    return f"flexpatrol_{plan}_monthly"


def _stripe() -> None:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise HTTPException(503, "Online sign-up isn't configured yet. Please contact sales.")
    if key.startswith(("sk_live_", "rk_live_")) and os.environ.get("STRIPE_ALLOW_LIVE") != "1":
        log.error("Live Stripe key present but STRIPE_ALLOW_LIVE is not set; refusing.")
        raise HTTPException(503, "Online sign-up is temporarily unavailable. Please contact sales.")
    stripe.api_key = key


def _price_id(plan: str) -> str:
    if plan not in _price_cache:
        prices = stripe.Price.list(lookup_keys=[lookup_key(plan)], active=True, limit=1)
        if not prices.data:
            log.error("No active Stripe price for lookup key %s (run scripts/stripe_seed_test.py)", lookup_key(plan))
            raise HTTPException(503, "That plan isn't available online yet. Please contact sales.")
        price = prices.data[0]
        expected = PLANS[plan][1] * 100
        if price.unit_amount != expected or price.recurring is None or price.recurring.interval != "month":
            log.error("Stripe price %s is %s/%s, expected %s/month", price.id, price.unit_amount,
                      price.recurring and price.recurring.interval, expected)
            raise HTTPException(503, "That plan isn't available online yet. Please contact sales.")
        _price_cache[plan] = price.id
    return _price_cache[plan]


class CheckoutRequest(BaseModel):
    plan: str
    company: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)


@router.post("/checkout-session")
def create_checkout_session(body: CheckoutRequest):
    plan = body.plan.strip().lower()
    if plan not in PLANS:
        raise HTTPException(400, "Unknown plan.")
    email = body.email.strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Please enter a valid work email.")
    _stripe()

    base = os.environ.get("SIGNUP_BASE_URL", "").rstrip("/")
    if not base:
        raise HTTPException(503, "Online sign-up isn't configured yet. Please contact sales.")

    meta = {"plan": plan, "company": body.company.strip(), "contact_name": body.name.strip(),
            "scans_per_month": str(PLANS[plan][2])}
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": _price_id(plan), "quantity": 1}],
            customer_email=email,
            billing_address_collection="auto",
            allow_promotion_codes=True,
            client_reference_id=re.sub(r"[^A-Za-z0-9_-]", "_", body.company.strip())[:200],
            metadata=meta,
            subscription_data={"metadata": meta},
            success_url=f"{base}/signup/success?plan={plan}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/signup/cancelled?plan={plan}",
        )
    except stripe.StripeError as e:
        log.exception("Stripe checkout session failed: %s", e)
        raise HTTPException(502, "Couldn't reach the payment processor. Please try again.")
    return {"url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, "Webhook not configured")
    payload = await request.body()
    try:
        stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature", ""), secret)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Bad signature")
    # Signature verified — work on plain dicts (newer stripe-python objects
    # aren't dicts, so .get() on them raises).
    event = json.loads(payload)

    obj = event["data"]["object"]
    kind = event["type"]
    if kind == "checkout.session.completed":
        md = obj.get("metadata") or {}
        log.info("NEW SIGNUP plan=%s company=%r contact=%r email=%s customer=%s subscription=%s livemode=%s",
                 md.get("plan"), md.get("company"), md.get("contact_name"),
                 (obj.get("customer_details") or {}).get("email"), obj.get("customer"),
                 obj.get("subscription"), event.get("livemode"))
        on_new_subscription(obj)
    elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
        log.info("%s subscription=%s status=%s", kind, obj.get("id"), obj.get("status"))
    elif kind == "invoice.payment_failed":
        log.warning("Payment failed: customer=%s invoice=%s", obj.get("customer"), obj.get("id"))
    return {"received": True}


def on_new_subscription(session: dict) -> None:
    """Hook for provisioning (create tenant, email login link, notify sales).
    Left as a log line for test mode — FlexPatrol tenants are still set up by hand."""
    return None
