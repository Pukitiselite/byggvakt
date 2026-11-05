const SUPABASE_URL = "https://fzsxqcqkzxrfxoirfmyh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable__tjgQ5uGHOd_j-l06VnlVQ_st5GWCf2";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = (req.headers.authorization || "")
      .match(/^Bearer (.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({ error: "Logg inn først." });
    }

    // Verify the logged-in user with their own token
    const authResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: "Bearer " + token
      }
    });

    if (!authResponse.ok) {
      return res.status(401).json({ error: "Ugyldig innlogging." });
    }

    const user = await authResponse.json();

    if (!user.id) {
      return res.status(401).json({ error: "Ugyldig bruker." });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      return res.status(503).json({ error: "Server not configured" });
    }

    // Read ONLY this user's subscription, using the server-side key
    const url = new URL(SUPABASE_URL + "/rest/v1/subscriptions");
    url.searchParams.set("user_id", "eq." + user.id);
    url.searchParams.set("select", "status,current_period_end");

    const response = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey
      }
    });

    if (!response.ok) {
      return res.status(503).json({
        error: "Kunne ikke kontrollere abonnementet."
      });
    }

    const rows = await response.json();
    const sub = rows[0];

    const periodEnd = sub?.current_period_end
      ? Date.parse(sub.current_period_end)
      : null;

    const active =
      !!sub &&
      ["active", "trialing"].includes(sub.status) &&
      (periodEnd === null || (Number.isFinite(periodEnd) && periodEnd > Date.now()));

    // Return only what the page needs, nothing else
    return res.status(200).json({
      active,
      status: sub?.status || "none",
      current_period_end: sub?.current_period_end || null
    });
  } catch (err) {
    console.error("Subscription status error:", err);
    return res.status(500).json({ error: "Noe gikk galt." });
  }
};
