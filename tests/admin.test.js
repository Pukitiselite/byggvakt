const test = require("node:test");
const assert = require("node:assert");

function mkRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("admin-stats: only the admin e-mail gets numbers", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.FREE_ACCESS_EMAILS = "tester@x.no";
  delete process.env.ADMIN_EMAILS;
  const users = [
    { id: "u1", email: "pukitiselite@gmail.com", email_confirmed_at: "2026-10-21", created_at: "2026-10-21T12:00:00Z" },
    { id: "u2", email: "tester@x.no", email_confirmed_at: "2026-11-20", created_at: "2026-11-20T12:00:00Z" },
    { id: "u3", email: "kunde@x.no", email_confirmed_at: null, created_at: new Date().toISOString() }
  ];
  let who = "pukitiselite@gmail.com";
  global.fetch = async (url) => {
    const ok = d => ({ ok: true, status: 200, json: async () => d });
    if (url.endsWith("/auth/v1/user")) return ok({ id: "x", email: who, email_confirmed_at: "2026-01-01" });
    if (url.includes("/auth/v1/admin/users")) return ok({ users });
    if (url.includes("subscriptions?")) return ok([{ user_id: "u1", status: "active", current_period_end: "2099-01-01T00:00:00Z", cancel_at_period_end: true, livemode: false }]);
    if (url.includes("projects?")) return ok([{ user_id: "u1" }, { user_id: "u3" }]);
    if (url.includes("ai_daily_usage?")) return ok([{ user_id: "u1", request_count: 4 }]);
    throw new Error("unexpected " + url);
  };
  delete require.cache[require.resolve("../api/admin-stats.js")];
  const handler = require("../api/admin-stats.js");
  const req = { method: "GET", headers: { authorization: "Bearer tok" } };

  let res = mkRes(); await handler(req, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const t = res.body.totals;
  assert.deepEqual([t.users, t.customers, t.testers, t.projects, t.ai_30d, t.new_today], [3, 1, 1, 2, 4, 1]);
  assert.equal(res.body.users.find(u => u.email === "pukitiselite@gmail.com").owner, true);

  who = "kunde@x.no";
  res = mkRes(); await handler(req, res);
  assert.equal(res.code, 403);
  assert.equal(res.body.totals, undefined);
});
