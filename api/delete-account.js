const billing = require("./_billing");

// POST /api/delete-account
// Authorization: Bearer <Supabase access token>
// Body: { "confirm": "SLETT" }
//
// Deletes the signed-in user's account and data:
//   1. cancels any open Stripe subscription immediately (no new charges)
//   2. deletes the user's photos in Storage (folder "<user id>/")
//   3. deletes AI usage counters
//   4. deletes the auth user -> projects and subscriptions rows cascade
// Stripe invoices/receipts are kept by Stripe (bookkeeping obligations).
const BUCKET = "byggvakt-bilder";
const OPEN = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: "Bearer " + key, ...extra };
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

async function deletePhotos(userId) {
  const base = billing.SUPABASE_URL + "/storage/v1/object";
  let deleted = 0;
  // Delete page by page until the folder is empty (max 50 rounds as a safety stop).
  for (let round = 0; round < 50; round++) {
    const list = await fetch(base + "/list/" + BUCKET, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: userId + "/", limit: 1000, offset: 0 })
    });
    if (!list.ok) throw new Error("Storage list failed: HTTP " + list.status);
    const items = (await list.json()).filter((o) => o && o.name && o.id !== null);
    if (!items.length) break;
    const paths = items.map((o) => userId + "/" + o.name);
    const del = await fetch(base + "/" + BUCKET, {
      method: "DELETE",
      headers: serviceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths })
    });
    if (!del.ok) throw new Error("Storage delete failed: HTTP " + del.status);
    deleted += paths.length;
  }
  return deleted;
}

async function deleteUsage(userId) {
  const url = new URL(billing.SUPABASE_URL + "/rest/v1/ai_daily_usage");
  url.searchParams.set("user_id", "eq." + userId);
  const r = await fetch(url, { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) });
  if (!r.ok) throw new Error("Usage delete failed: HTTP " + r.status);
}

async function deleteAuthUser(userId) {
  const r = await fetch(billing.SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
    method: "DELETE",
    headers: serviceHeaders()
  });
  if (!r.ok && r.status !== 404) throw new Error("Auth delete failed: HTTP " + r.status);
}

function createHandler(deps = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      billing.log("error", "delete.config_missing");
      return res.status(503).json({ error: "Server not configured" });
    }

    let user;
    try {
      user = await billing.getUserFromRequest(req);
    } catch (err) {
      billing.log("error", "delete.auth_failed", { detail: err.message });
      return res.status(503).json({ error: "Kunne ikke kontrollere innlogging." });
    }
    if (!user) return res.status(401).json({ error: "Logg inn først." });

    const body = await readJson(req);
    if (body.confirm !== "SLETT") {
      return res.status(400).json({ error: "Skriv SLETT for å bekrefte." });
    }

    try {
      // 1) Stop all billing first. If this fails, nothing is deleted.
      const row = await billing.getSubscriptionRow(user.id);
      const customerId = row && row.stripe_customer_id;
      let canceled = 0;
      if (customerId && process.env.STRIPE_SECRET_KEY) {
        const stripe = deps.stripe || billing.getStripe();
        let subs = { data: [] };
        try {
          subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
        } catch (err) {
          if (err.code !== "resource_missing") throw err; // customer from another account: nothing to cancel
        }
        for (const s of subs.data.filter((s) => OPEN.includes(s.status))) {
          await stripe.subscriptions.cancel(s.id);
          canceled++;
        }
      }

      // 2-4) Delete data, then the account itself.
      const photos = await deletePhotos(user.id);
      await deleteUsage(user.id);
      await deleteAuthUser(user.id);

      billing.log("info", "delete.completed", { user_id: user.id, photos, canceled_subscriptions: canceled });
      return res.status(200).json({ deleted: true });
    } catch (err) {
      billing.log("error", "delete.failed", { user_id: user.id, stripe_type: err.type, code: err.code, detail: err.message });
      return res.status(500).json({ error: "Kunne ikke slette kontoen. Prøv igjen, eller kontakt oss." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
