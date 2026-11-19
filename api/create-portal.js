const billing = require("./_billing");

// POST /api/create-portal
// Authorization: Bearer <Supabase access token>
// -> 200 { url } to the Stripe Customer Portal (cancel, renew, change card, invoices)
function createHandler(deps = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      billing.log("error", "portal.config_missing");
      return res.status(503).json({ error: "Betaling er ikke konfigurert." });
    }

    let user;
    try {
      user = await billing.getUserFromRequest(req);
    } catch (err) {
      billing.log("error", "portal.auth_failed", { detail: err.message });
      return res.status(503).json({ error: "Kunne ikke kontrollere innlogging." });
    }
    if (!user) return res.status(401).json({ error: "Logg inn først." });

    const stripe = deps.stripe || billing.getStripe();

    try {
      const row = await billing.getSubscriptionRow(user.id);
      const sameMode = row && (typeof row.livemode !== "boolean" || row.livemode === billing.isLiveKey());
      let customerId = sameMode ? row.stripe_customer_id : null;

      if (customerId) {
        try {
          const c = await stripe.customers.retrieve(customerId);
          if (c.deleted) customerId = null;
        } catch (err) {
          if (err.code !== "resource_missing") throw err;
          customerId = null;
        }
      }
      if (!customerId) {
        return res.status(404).json({ error: "Fant ikke noe abonnement å administrere." });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: billing.safeSiteUrl(req.headers.host) + "/?portal=return"
      });

      billing.log("info", "portal.created", { user_id: user.id });
      return res.status(200).json({ url: session.url });
    } catch (err) {
      billing.log("error", "portal.failed", {
        user_id: user.id,
        stripe_type: err.type,
        code: err.code,
        request_id: err.requestId,
        detail: err.message
      });
      return res.status(500).json({ error: "Kunne ikke åpne abonnementsinnstillinger." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
