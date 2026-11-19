const billing = require("./_billing");

// POST /api/create-checkout
// Authorization: Bearer <Supabase access token>
// -> 200 { url } | 401 | 409 already subscribed | 5xx
// The user id comes ONLY from the verified Supabase token.
function createHandler(deps = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!process.env.STRIPE_SECRET_KEY || !priceId || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      billing.log("error", "checkout.config_missing", {
        has_price: !!priceId,
        has_stripe: !!process.env.STRIPE_SECRET_KEY,
        has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      });
      return res.status(503).json({ error: "Betaling er ikke konfigurert." });
    }

    let user;
    try {
      user = await billing.getUserFromRequest(req);
    } catch (err) {
      billing.log("error", "checkout.auth_failed", { detail: err.message });
      return res.status(503).json({ error: "Kunne ikke kontrollere innlogging." });
    }
    if (!user) return res.status(401).json({ error: "Logg inn først." });

    const stripe = deps.stripe || billing.getStripe();

    try {
      // 1) Our own record: block if a subscription already exists in this mode.
      const row = await billing.getSubscriptionRow(user.id);
      const sameMode = row && (typeof row.livemode !== "boolean" || row.livemode === billing.isLiveKey());
      if (sameMode && billing.BLOCKING_STATUSES.includes(row.status)) {
        billing.log("info", "checkout.blocked_existing_db", { user_id: user.id, status: row.status });
        return res.status(409).json({ error: "Du har allerede et abonnement." });
      }

      // 2) Exactly one Stripe customer per user.
      let customerId = sameMode ? row.stripe_customer_id : null;
      if (!customerId) {
        const found = await stripe.customers.search({
          query: "metadata['supabase_user_id']:'" + user.id + "'",
          limit: 1
        });
        customerId = found.data[0]?.id || null;
      }
      if (!customerId) {
        const customer = await stripe.customers.create(
          { email: user.email || undefined, metadata: { supabase_user_id: user.id } },
          { idempotencyKey: "customer:" + user.id }
        );
        customerId = customer.id;
      }

      // 3) Ask Stripe too (covers a payment whose webhook has not arrived yet).
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
      const open = subs.data.find((s) => billing.BLOCKING_STATUSES.includes(s.status));
      if (open) {
        billing.log("info", "checkout.blocked_existing_stripe", { user_id: user.id, subscription: open.id, status: open.status });
        return res.status(409).json({ error: "Du har allerede et abonnement." });
      }

      // 4) Reuse an open Checkout Session (double clicks, two tabs).
      const sessions = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 10 });
      const reusable = sessions.data.find((s) => s.mode === "subscription" && s.url);
      if (reusable) {
        billing.log("info", "checkout.reuse_open_session", { user_id: user.id, session: reusable.id });
        return res.status(200).json({ url: reusable.url });
      }

      const siteUrl = (process.env.PUBLIC_SITE_URL || "https://" + req.headers.host).replace(/\/$/, "");
      const metadata = { supabase_user_id: user.id };

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          client_reference_id: user.id,
          line_items: [{ price: priceId, quantity: 1 }],
          metadata,
          subscription_data: { metadata },
          success_url: siteUrl + "/?payment=success",
          cancel_url: siteUrl + "/?payment=cancelled"
        },
        { idempotencyKey: billing.checkoutIdempotencyKey(user.id, priceId) }
      );

      billing.log("info", "checkout.created", { user_id: user.id, session: session.id, livemode: session.livemode });
      return res.status(200).json({ url: session.url });
    } catch (err) {
      billing.log("error", "checkout.failed", {
        user_id: user.id,
        stripe_type: err.type,
        code: err.code,
        request_id: err.requestId,
        detail: err.message
      });
      return res.status(500).json({ error: "Kunne ikke starte betaling." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
