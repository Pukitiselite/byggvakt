const billing = require("./_billing");

// GET /api/subscription-status
// Authorization: Bearer <Supabase access token>
// -> { active, tester, status, current_period_end, cancel_at_period_end }
// Read-only. Rows are written only by the signature-verified Stripe webhook.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    billing.log("error", "status.config_missing");
    return res.status(503).json({ error: "Server not configured" });
  }

  let user;
  try {
    user = await billing.getUserFromRequest(req);
  } catch (err) {
    billing.log("error", "status.auth_failed", { detail: err.message });
    return res.status(503).json({ error: "Kunne ikke kontrollere innlogging." });
  }
  if (!user) return res.status(401).json({ error: "Logg inn først." });

  try {
    const row = await billing.getSubscriptionRow(user.id);
    const sameMode = row && (typeof row.livemode !== "boolean" || row.livemode === billing.isLiveKey());
    const shown = sameMode ? row : null;

    const paid = billing.rowGrantsAccess(shown);
    const tester = !paid && billing.isFreeAccessUser(user);

    return res.status(200).json({
      active: paid || tester,
      tester,
      // a first-time subscriber gets a free trial (no subscription row in this mode yet)
      trial_days: !shown ? billing.trialDays() : 0,
      status: shown?.status || "none",
      current_period_end: shown?.current_period_end || null,
      cancel_at_period_end: !!shown?.cancel_at_period_end
    });
  } catch (err) {
    billing.log("error", "status.failed", { user_id: user.id, detail: err.message });
    return res.status(503).json({ error: "Kunne ikke kontrollere abonnementet." });
  }
};
