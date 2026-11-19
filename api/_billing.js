// Shared Stripe <-> Supabase billing helpers.
// Files starting with "_" inside /api are NOT exposed as Vercel endpoints.
// No secrets, emails or full payloads are ever logged.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fzsxqcqkzxrfxoirfmyh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable__tjgQ5uGHOd_j-l06VnlVQ_st5GWCf2";

// Statuses that grant access to paid features.
const ACCESS_STATUSES = ["active", "trialing"];
// Statuses where starting a NEW checkout must be blocked (a subscription already exists).
const BLOCKING_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];

// Columns that exist in the original table. Extra columns are written only if present.
const CORE_COLUMNS = ["user_id", "stripe_customer_id", "stripe_subscription_id", "status", "current_period_end", "updated_at"];

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY missing");
    const Stripe = require("stripe");
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
  }
  return _stripe;
}

function isLiveKey(key = process.env.STRIPE_SECRET_KEY || "") {
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}

function log(level, msg, fields = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (/secret|key|token|email|password|authorization/i.test(k)) continue;
    safe[k] = typeof v === "string" && v.length > 300 ? v.slice(0, 300) : v;
  }
  const line = JSON.stringify({ level, msg, ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function idOf(x) {
  return x && typeof x === "object" ? x.id : x || null;
}

// ---------- Supabase ----------

async function getUserFromRequest(req) {
  const token = (req.headers.authorization || "").match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user && user.id ? user : null;
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  return { apikey: key, Authorization: "Bearer " + key, ...extra };
}

// Reads the user's subscription row. Falls back to core columns if the
// additive migration has not been run yet.
async function getSubscriptionRow(userId) {
  const attempt = async (select) => {
    const url = new URL(SUPABASE_URL + "/rest/v1/subscriptions");
    url.searchParams.set("user_id", "eq." + userId);
    url.searchParams.set("select", select);
    return fetch(url, { headers: serviceHeaders() });
  };
  let r = await attempt("stripe_customer_id,stripe_subscription_id,status,current_period_end,cancel_at_period_end,livemode");
  if (r.status === 400) r = await attempt("stripe_customer_id,stripe_subscription_id,status,current_period_end");
  if (!r.ok) throw new Error("Supabase read failed: HTTP " + r.status);
  const rows = await r.json();
  return rows[0] || null;
}

async function findUserIdBySubscriptionOrCustomer(subscriptionId, customerId) {
  const url = new URL(SUPABASE_URL + "/rest/v1/subscriptions");
  const ors = [];
  if (subscriptionId) ors.push("stripe_subscription_id.eq." + subscriptionId);
  if (customerId) ors.push("stripe_customer_id.eq." + customerId);
  if (!ors.length) return null;
  url.searchParams.set("or", "(" + ors.join(",") + ")");
  url.searchParams.set("select", "user_id");
  url.searchParams.set("limit", "1");
  const r = await fetch(url, { headers: serviceHeaders() });
  if (!r.ok) throw new Error("Supabase lookup failed: HTTP " + r.status);
  const rows = await r.json();
  return rows[0]?.user_id || null;
}

async function upsertRow(record) {
  const post = (body) =>
    fetch(SUPABASE_URL + "/rest/v1/subscriptions?on_conflict=user_id", {
      method: "POST",
      headers: serviceHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify(body)
    });

  let r = await post(record);
  if (!r.ok && r.status === 400) {
    const text = await r.text();
    // PGRST204 = column not found -> the additive migration is not applied yet.
    if (text.includes("PGRST204")) {
      log("warn", "billing.extra_columns_missing_fallback");
      const core = {};
      for (const c of CORE_COLUMNS) if (c in record) core[c] = record[c];
      r = await post(core);
    } else {
      throw new Error("Supabase upsert failed: HTTP 400 " + text.slice(0, 200));
    }
  }
  if (!r.ok) throw new Error("Supabase upsert failed: HTTP " + r.status + " " + (await r.text()).slice(0, 200));
}

// ---------- Mapping & rules ----------

function periodEndIso(sub) {
  const ts = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function subscriptionToRecord(sub, userId) {
  return {
    user_id: userId,
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_end: periodEndIso(sub),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    livemode: !!sub.livemode,
    updated_at: new Date().toISOString()
  };
}

// Does this row grant access on THIS deployment (test key vs live key)?
function rowGrantsAccess(row, now = Date.now()) {
  if (!row || !ACCESS_STATUSES.includes(row.status)) return false;
  if (typeof row.livemode === "boolean" && row.livemode !== isLiveKey()) return false;
  if (row.current_period_end) {
    const end = Date.parse(row.current_period_end);
    if (!Number.isFinite(end) || end <= now) return false;
  }
  return true;
}

// One row per user. Decide whether an incoming Stripe subscription may overwrite it.
function shouldOverwrite(existing, incoming) {
  if (!existing || !existing.stripe_subscription_id) return { ok: true };
  // A test-mode event must never overwrite a live row.
  if (existing.livemode === true && incoming.livemode === false) return { ok: false, reason: "live_row_protected" };
  if (existing.stripe_subscription_id === incoming.stripe_subscription_id) return { ok: true };
  // Different subscription: don't let an old/ended one replace a currently open one.
  const existingOpen = BLOCKING_STATUSES.includes(existing.status);
  const incomingOpen = BLOCKING_STATUSES.includes(incoming.status);
  if (existingOpen && !incomingOpen) return { ok: false, reason: "stale_subscription_event" };
  return { ok: true };
}

/**
 * Resolve the Supabase user that owns a subscription.
 * Only server-set metadata is trusted. client_reference_id alone is NOT trusted
 * (anyone can append it to a Payment Link URL), but a mismatch is logged and rejected.
 */
async function resolveUserId({ sub, session }) {
  const candidates = [
    ["subscription.metadata", sub?.metadata?.supabase_user_id],
    ["session.metadata", session?.metadata?.supabase_user_id],
    ["customer.metadata", sub?.customer && typeof sub.customer === "object" ? sub.customer.metadata?.supabase_user_id : null]
  ].filter(([, v]) => !!v);

  const distinct = [...new Set(candidates.map(([, v]) => v))];
  if (distinct.length > 1) return { userId: null, source: "conflict" };
  if (session?.client_reference_id && distinct[0] && session.client_reference_id !== distinct[0]) {
    return { userId: null, source: "conflict" };
  }
  if (distinct[0]) return { userId: distinct[0], source: candidates[0][0] };

  const fromDb = await findUserIdBySubscriptionOrCustomer(sub?.id, idOf(sub?.customer));
  if (fromDb) return { userId: fromDb, source: "db" };
  return { userId: null, source: null };
}

function checkoutIdempotencyKey(userId, priceId, now = Date.now()) {
  return "checkout:" + userId + ":" + priceId + ":" + Math.floor(now / (10 * 60 * 1000));
}

module.exports = {
  SUPABASE_URL,
  ACCESS_STATUSES,
  BLOCKING_STATUSES,
  getStripe,
  isLiveKey,
  log,
  idOf,
  getUserFromRequest,
  getSubscriptionRow,
  upsertRow,
  periodEndIso,
  subscriptionToRecord,
  rowGrantsAccess,
  shouldOverwrite,
  resolveUserId,
  checkoutIdempotencyKey,
  _resetStripe: () => { _stripe = null; }
};
