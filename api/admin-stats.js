const billing = require("./_billing");

// GET /api/admin-stats  (Authorization: Bearer <Supabase access token>)
// Owner-only overview: sign-ups, subscribers, testers, projects, AI use.
// Allowed e-mails: ADMIN_EMAILS (comma separated), default the owner's address.
const DEFAULT_ADMINS = "pukitiselite@gmail.com";

function isAdmin(user) {
  const list = String(process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return !!(user && user.email && (user.email_confirmed_at || user.confirmed_at) &&
    list.includes(String(user.email).trim().toLowerCase()));
}

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: "Bearer " + key };
}

async function getJson(url) {
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url.split("?")[0].replace(billing.SUPABASE_URL, ""));
  return r.json();
}

async function listUsers() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const data = await getJson(`${billing.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = data.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ error: "Server not configured" });

  let user;
  try { user = await billing.getUserFromRequest(req); }
  catch (err) { return res.status(503).json({ error: "Kunne ikke kontrollere innlogging." }); }
  if (!user) return res.status(401).json({ error: "Logg inn først." });
  if (!isAdmin(user)) return res.status(403).json({ error: "Ingen tilgang." });

  try {
    const base = billing.SUPABASE_URL + "/rest/v1/";
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [users, subs, projects, usage] = await Promise.all([
      listUsers(),
      getJson(base + "subscriptions?select=user_id,status,current_period_end,cancel_at_period_end,livemode"),
      getJson(base + "projects?select=user_id,created_at"),
      getJson(base + `ai_daily_usage?select=user_id,usage_date,request_count&usage_date=gte.${since30}`)
    ]);

    const live = billing.isLiveKey();
    const testers = String(process.env.FREE_ACCESS_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const admins = String(process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const subBy = new Map(subs.filter(s => typeof s.livemode !== "boolean" || s.livemode === live).map(s => [s.user_id, s]));
    const projBy = new Map(); for (const p of projects) projBy.set(p.user_id, (projBy.get(p.user_id) || 0) + 1);
    const aiBy = new Map(); for (const u of usage) aiBy.set(u.user_id, (aiBy.get(u.user_id) || 0) + (u.request_count || 0));

    const now = Date.now();
    const rows = users.map(u => {
      const email = String(u.email || "").toLowerCase();
      const s = subBy.get(u.id);
      const paying = !!(s && billing.rowGrantsAccess(s));
      return {
        email: u.email || "",
        created_at: u.created_at,
        confirmed: !!(u.email_confirmed_at || u.confirmed_at),
        last_sign_in_at: u.last_sign_in_at || null,
        subscription: s ? { status: s.status, current_period_end: s.current_period_end, cancel_at_period_end: !!s.cancel_at_period_end } : null,
        paying,
        tester: testers.includes(email),
        owner: admins.includes(email),
        projects: projBy.get(u.id) || 0,
        ai_30d: aiBy.get(u.id) || 0
      };
    }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const days = n => rows.filter(r => now - Date.parse(r.created_at) <= n * 864e5).length;
    const customers = rows.filter(r => !r.owner && !r.tester);
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      totals: {
        users: rows.length,
        customers: customers.length,
        new_today: rows.filter(r => new Date(r.created_at).toDateString() === new Date().toDateString()).length,
        new_7d: days(7),
        new_30d: days(30),
        confirmed: rows.filter(r => r.confirmed).length,
        paying: rows.filter(r => r.paying).length,
        paying_customers: customers.filter(r => r.paying).length,
        renewing: rows.filter(r => r.paying && !(r.subscription && r.subscription.cancel_at_period_end)).length,
        testers: rows.filter(r => r.tester).length,
        projects: projects.length,
        ai_30d: usage.reduce((s, u) => s + (u.request_count || 0), 0)
      },
      users: rows
    });
  } catch (err) {
    billing.log("error", "admin.stats_failed", { detail: err.message });
    return res.status(500).json({ error: "Kunne ikke hente tall." });
  }
};
