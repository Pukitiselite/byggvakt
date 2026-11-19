const billing = require("./_billing");

// POST /api/stripe-webhook
//   400 -> invalid/missing signature
//   500 -> temporary failure (Stripe retries automatically for up to 3 days)
//   200 -> handled, ignored or permanently unresolvable (logged for follow-up)
// Each handler re-reads the subscription from Stripe, so event order does not matter.

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed"
]);

function subscriptionIdFromEvent(event) {
  const obj = event.data.object;
  if (event.type === "checkout.session.completed") return billing.idOf(obj.subscription);
  if (event.type.startsWith("customer.subscription.")) return obj.id;
  if (event.type.startsWith("invoice.")) {
    return billing.idOf(obj.subscription) || billing.idOf(obj.parent?.subscription_details?.subscription) || null;
  }
  return null;
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      billing.log("error", "webhook.config_missing", {
        has_stripe: !!process.env.STRIPE_SECRET_KEY,
        has_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
        has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      });
      return res.status(503).json({ error: "Server not configured" });
    }

    const stripe = deps.stripe || billing.getStripe();

    let event;
    try {
      const sig = req.headers["stripe-signature"];
      if (!sig) throw new Error("missing stripe-signature header");
      event = stripe.webhooks.constructEvent(await readRawBody(req), sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      billing.log("warn", "webhook.signature_invalid", { detail: err.message });
      return res.status(400).json({ error: "Invalid Stripe signature" });
    }

    const base = { event_id: event.id, type: event.type, livemode: event.livemode };

    // A test event must never change a live deployment, and vice versa.
    if (event.livemode !== billing.isLiveKey()) {
      billing.log("warn", "webhook.mode_mismatch_ignored", base);
      return res.status(200).json({ received: true, ignored: "mode_mismatch" });
    }

    if (!HANDLED.has(event.type)) {
      return res.status(200).json({ received: true, ignored: "unhandled_type" });
    }

    try {
      const obj = event.data.object;

      if (event.type === "checkout.session.completed" && obj.mode !== "subscription") {
        return res.status(200).json({ received: true, ignored: "not_subscription" });
      }

      const subId = subscriptionIdFromEvent(event);
      if (!subId) {
        billing.log("info", "webhook.no_subscription_on_event", base);
        return res.status(200).json({ received: true, ignored: "no_subscription" });
      }

      const sub = await stripe.subscriptions.retrieve(subId, { expand: ["customer"] });
      const session = event.type === "checkout.session.completed" ? obj : null;
      const { userId, source } = await billing.resolveUserId({ sub, session });

      if (!userId) {
        // Permanent problem: retrying will not help. Needs manual follow-up.
        billing.log("error", "webhook.user_unresolved", {
          ...base,
          reason: source || "no_metadata",
          subscription: sub.id,
          customer: billing.idOf(sub.customer)
        });
        return res.status(200).json({ received: true, ignored: "user_unresolved" });
      }

      // Backfill metadata so future events always resolve directly.
      if (!sub.metadata?.supabase_user_id) {
        await stripe.subscriptions.update(sub.id, { metadata: { supabase_user_id: userId } });
      }

      const record = billing.subscriptionToRecord(sub, userId);
      const existing = await billing.getSubscriptionRow(userId);
      const decision = billing.shouldOverwrite(existing, record);
      if (!decision.ok) {
        billing.log("warn", "webhook.skipped_overwrite", { ...base, user_id: userId, subscription: sub.id, reason: decision.reason });
        return res.status(200).json({ received: true, ignored: decision.reason });
      }

      await billing.upsertRow(record);

      billing.log("info", "webhook.subscription_synced", {
        ...base,
        user_id: userId,
        user_source: source,
        subscription: sub.id,
        status: record.status,
        cancel_at_period_end: record.cancel_at_period_end
      });
      return res.status(200).json({ received: true });
    } catch (err) {
      if (err.code === "user_deleted") {
        billing.log("info", "webhook.user_deleted_ignored", base);
        return res.status(200).json({ received: true, ignored: "user_deleted" });
      }
      billing.log("error", "webhook.processing_failed", {
        ...base,
        stripe_type: err.type,
        code: err.code,
        detail: err.message
      });
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.config = { api: { bodyParser: false } };
