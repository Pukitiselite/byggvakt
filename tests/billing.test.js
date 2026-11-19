// Run: node --test tests/billing.test.js   (no network, no real Stripe/Supabase)
const test = require("node:test");
const assert = require("node:assert");

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
process.env.STRIPE_PRICE_ID = "price_test_245nok";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service_dummy";

const billing = require("../api/_billing");
const checkout = require("../api/create-checkout").createHandler;
const webhook = require("../api/stripe-webhook").createHandler;
const status = require("../api/subscription-status");

// ---------- mock Supabase REST via global fetch ----------
function installSupabase({ legacySchema = false, failUpsert = false } = {}) {
  const db = { rows: [] };
  const users = { "tok-anna": { id: "user-anna", email: "a@x" }, "tok-bob": { id: "user-bob", email: "b@x" } };
  const extra = ["cancel_at_period_end", "livemode"];
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      const tok = (init.headers.Authorization || "").replace("Bearer ", "");
      return users[tok] ? json(200, users[tok]) : json(401, { msg: "bad" });
    }
    if (url.pathname === "/rest/v1/subscriptions" && (!init.method || init.method === "GET")) {
      const select = (url.searchParams.get("select") || "").split(",");
      if (legacySchema && select.some((c) => extra.includes(c))) return json(400, { code: "42703" });
      let rows = db.rows;
      const uid = url.searchParams.get("user_id");
      if (uid) rows = rows.filter((r) => r.user_id === uid.slice(3));
      const or = url.searchParams.get("or");
      if (or) {
        const conds = or.slice(1, -1).split(",").map((c) => c.split(".eq."));
        rows = rows.filter((r) => conds.some(([c, v]) => r[c] === v));
      }
      return json(200, rows.map((r) => Object.fromEntries(select.map((c) => [c, r[c]]))));
    }
    if (url.pathname === "/rest/v1/subscriptions" && init.method === "POST") {
      if (failUpsert) return json(503, { message: "down" });
      const rec = JSON.parse(init.body);
      if (legacySchema && Object.keys(rec).some((c) => extra.includes(c))) return json(400, { code: "PGRST204" });
      const i = db.rows.findIndex((r) => r.user_id === rec.user_id);
      if (i >= 0) db.rows[i] = { ...db.rows[i], ...rec }; else db.rows.push(rec);
      return json(201, null);
    }
    throw new Error("unexpected fetch " + url);
  };
  return db;
}

// ---------- mock Stripe ----------
function mockStripe() {
  const s = { customers: {}, subs: {}, sessions: {}, created: { sessions: 0, customers: 0 }, n: 0 };
  const nid = (p) => p + "_" + ++s.n;
  s.api = {
    customers: {
      search: async ({ query }) => {
        const uid = query.match(/:'(.+)'$/)[1];
        return { data: Object.values(s.customers).filter((c) => c.metadata.supabase_user_id === uid) };
      },
      create: async (p) => { const c = { id: nid("cus"), ...p }; s.customers[c.id] = c; s.created.customers++; return c; },
      retrieve: async (id) => {
        if (!s.customers[id]) { const e = new Error("No such customer: '" + id + "'"); e.code = "resource_missing"; throw e; }
        return s.customers[id];
      }
    },
    subscriptions: {
      list: async ({ customer }) => ({ data: Object.values(s.subs).filter((x) => x.customer === customer) }),
      retrieve: async (id) => { const x = s.subs[id]; return { ...x, metadata: { ...x.metadata }, customer: s.customers[x.customer] }; },
      update: async (id, p) => { Object.assign(s.subs[id].metadata, p.metadata || {}); return s.subs[id]; }
    },
    checkout: {
      sessions: {
        list: async ({ customer, status }) => ({ data: Object.values(s.sessions).filter((x) => x.customer === customer && x.status === status) }),
        create: async (p) => {
          const x = { id: nid("cs"), url: "https://checkout.stripe.test/" + s.n, status: "open", livemode: false, ...p };
          s.sessions[x.id] = x; s.created.sessions++; return x;
        }
      }
    },
    webhooks: {
      constructEvent: (raw, sig) => {
        if (sig !== "valid") throw new Error("No signatures found matching the expected signature");
        return JSON.parse(raw.toString());
      }
    }
  };
  s.pay = (sessionId) => {
    const cs = s.sessions[sessionId];
    cs.status = "complete";
    const sub = {
      id: nid("sub"), customer: cs.customer, status: "active", livemode: false, cancel_at_period_end: false,
      metadata: { ...cs.subscription_data.metadata },
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }
    };
    s.subs[sub.id] = sub;
    cs.subscription = sub.id;
    return sub;
  };
  return s;
}

function mkRes() {
  const r = { code: 0, body: null, setHeader() {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const call = async (h, req) => { const r = mkRes(); await h(req, r); return r; };
const authed = (method, tok = "tok-anna") => ({ method, headers: { authorization: "Bearer " + tok, host: "preview.vercel.app" } });
const evt = (type, object, livemode = false, sig = "valid") => ({
  method: "POST",
  headers: { "stripe-signature": sig },
  body: Buffer.from(JSON.stringify({ id: "evt_" + Math.random(), type, livemode, data: { object } }))
});

test("payment -> active -> cancel at period end -> renew -> cancel now -> resubscribe", async () => {
  const db = installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };

  assert.equal((await call(checkout(deps), authed("POST", "nope"))).code, 401);

  let r = await call(checkout(deps), authed("POST"));
  assert.equal(r.code, 200);
  const cs = Object.values(st.sessions)[0];
  assert.equal(cs.mode, "subscription");
  assert.equal(cs.metadata.supabase_user_id, "user-anna");
  assert.equal(cs.subscription_data.metadata.supabase_user_id, "user-anna");
  assert.equal(cs.client_reference_id, "user-anna");
  assert.equal(cs.line_items[0].price, "price_test_245nok");
  assert.equal(cs.success_url, "https://preview.vercel.app/?payment=success");

  // double click -> same session, no 2nd customer
  r = await call(checkout(deps), authed("POST"));
  assert.equal(r.body.url, cs.url);
  assert.deepEqual(st.created, { sessions: 1, customers: 1 });

  assert.equal((await call(status, authed("GET"))).body.active, false);

  const sub = st.pay(cs.id);
  r = await call(webhook(deps), evt("checkout.session.completed", st.sessions[cs.id]));
  assert.equal(r.code, 200);
  assert.equal(db.rows[0].status, "active");
  assert.equal(db.rows[0].livemode, false);

  r = await call(status, authed("GET"));
  assert.equal(r.body.active, true);
  assert.equal(r.body.status, "active");

  assert.equal((await call(checkout(deps), authed("POST"))).code, 409);

  st.subs[sub.id].cancel_at_period_end = true;
  await call(webhook(deps), evt("customer.subscription.updated", { id: sub.id }));
  r = await call(status, authed("GET"));
  assert.deepEqual([r.body.active, r.body.cancel_at_period_end], [true, true]);

  st.subs[sub.id].cancel_at_period_end = false;
  await call(webhook(deps), evt("customer.subscription.updated", { id: sub.id }));
  assert.equal((await call(status, authed("GET"))).body.cancel_at_period_end, false);

  st.subs[sub.id].status = "canceled";
  await call(webhook(deps), evt("customer.subscription.deleted", { id: sub.id }));
  r = await call(status, authed("GET"));
  assert.deepEqual([r.body.active, r.body.status], [false, "canceled"]);

  // resubscribe: allowed, same customer, row now points to the new subscription
  r = await call(checkout(deps), authed("POST"));
  assert.equal(r.code, 200);
  assert.equal(st.created.customers, 1);
  const cs2 = Object.values(st.sessions).find((x) => x.status === "open");
  const sub2 = st.pay(cs2.id);
  await call(webhook(deps), evt("checkout.session.completed", st.sessions[cs2.id]));
  // a late event for the OLD canceled subscription must not remove access
  await call(webhook(deps), evt("customer.subscription.deleted", { id: sub.id }));
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].stripe_subscription_id, sub2.id);
  assert.equal((await call(status, authed("GET"))).body.active, true);
});

test("checkout blocked by Stripe when paid but webhook not yet delivered", async () => {
  installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };
  await call(checkout(deps), authed("POST"));
  st.pay(Object.keys(st.sessions)[0]);
  const r = await call(checkout(deps), authed("POST"));
  assert.equal(r.code, 409);
  assert.equal(st.created.sessions, 1);
});

test("invoice.payment_failed -> past_due -> no access, new checkout still blocked", async () => {
  installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };
  await call(checkout(deps), authed("POST"));
  const sub = st.pay(Object.keys(st.sessions)[0]);
  st.subs[sub.id].status = "past_due";
  await call(webhook(deps), evt("invoice.payment_failed", { parent: { subscription_details: { subscription: sub.id } } }));
  assert.equal((await call(status, authed("GET"))).body.active, false);
  assert.equal((await call(checkout(deps), authed("POST"))).code, 409);
});

test("bad signature -> 400 and nothing written", async () => {
  const db = installSupabase(); const st = mockStripe();
  const r = await call(webhook({ stripe: st.api }), evt("checkout.session.completed", {}, false, "forged"));
  assert.equal(r.code, 400);
  assert.equal(db.rows.length, 0);
});

test("live event on a test deployment is ignored", async () => {
  const db = installSupabase(); const st = mockStripe();
  const r = await call(webhook({ stripe: st.api }), evt("checkout.session.completed", {}, true));
  assert.equal(r.body.ignored, "mode_mismatch");
  assert.equal(db.rows.length, 0);
});

test("test row never grants access on live, and never overwrites a live row", () => {
  process.env.STRIPE_SECRET_KEY = "sk_live_dummy";
  const end = new Date(Date.now() + 86400000).toISOString();
  assert.equal(billing.rowGrantsAccess({ status: "active", livemode: false, current_period_end: end }), false);
  assert.equal(billing.rowGrantsAccess({ status: "active", livemode: true, current_period_end: end }), true);
  assert.equal(billing.rowGrantsAccess({ status: "active", current_period_end: end }), true); // legacy row
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  assert.equal(
    billing.shouldOverwrite({ stripe_subscription_id: "sub_live", livemode: true, status: "active" }, { stripe_subscription_id: "sub_t", livemode: false, status: "active" }).ok,
    false
  );
});

test("Supabase down -> 500 so Stripe retries", async () => {
  installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };
  await call(checkout(deps), authed("POST"));
  const sub = st.pay(Object.keys(st.sessions)[0]);
  installSupabase({ failUpsert: true });
  const r = await call(webhook(deps), evt("customer.subscription.created", { id: sub.id }));
  assert.equal(r.code, 500);
});

test("works before the migration (legacy columns only)", async () => {
  const db = installSupabase({ legacySchema: true }); const st = mockStripe(); const deps = { stripe: st.api };
  await call(checkout(deps), authed("POST"));
  const sub = st.pay(Object.keys(st.sessions)[0]);
  const r = await call(webhook(deps), evt("customer.subscription.created", { id: sub.id }));
  assert.equal(r.code, 200);
  assert.equal(db.rows[0].status, "active");
  assert.ok(!("livemode" in db.rows[0]));
  assert.equal((await call(status, authed("GET"))).body.active, true);
});

test("forged client_reference_id (Payment Link) is not trusted", async () => {
  const db = installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };
  await call(checkout(deps), authed("POST"));
  const sub = st.pay(Object.keys(st.sessions)[0]);
  const r = await call(webhook(deps), evt("checkout.session.completed", { mode: "subscription", subscription: sub.id, client_reference_id: "user-bob", metadata: {} }));
  assert.equal(r.body.ignored, "user_unresolved");
  assert.equal(db.rows.length, 0);
});

test("missing subscription metadata is resolved from customer and backfilled", async () => {
  const db = installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };
  await call(checkout(deps), authed("POST"));
  const sub = st.pay(Object.keys(st.sessions)[0]);
  st.subs[sub.id].metadata = {};
  await call(webhook(deps), evt("customer.subscription.created", { id: sub.id }));
  assert.equal(db.rows[0].user_id, "user-anna");
  assert.equal(st.subs[sub.id].metadata.supabase_user_id, "user-anna");
});

test("logs never contain secrets or emails", () => {
  const out = []; const orig = console.log; console.log = (l) => out.push(l);
  billing.log("info", "x", { email: "a@b.c", api_key: "sk_live_1", authorization: "Bearer t", user_id: "u1" });
  console.log = orig;
  assert.ok(!/a@b\.c|sk_live|Bearer/.test(out[0]));
  assert.ok(out[0].includes("u1"));
});

test("redirect URL only to own domains", () => {
  assert.equal(billing.safeSiteUrl("byggvakt-git-fix-x.vercel.app"), "https://byggvakt-git-fix-x.vercel.app");
  assert.equal(billing.safeSiteUrl("evil.example.com"), "https://byggvakt.vercel.app");
  assert.equal(billing.safeSiteUrl("evil.com/x.vercel.app"), "https://byggvakt.vercel.app");
  assert.equal(billing.safeSiteUrl(undefined), "https://byggvakt.vercel.app");
});

test("idempotency key changes with parameters, stable within 10 min", () => {
  const t = 1_700_000_000_000;
  const a = billing.checkoutIdempotencyKey("u", "p", "cus_1", "https://a.vercel.app", t);
  assert.equal(a, billing.checkoutIdempotencyKey("u", "p", "cus_1", "https://a.vercel.app", t + 1000));
  assert.notEqual(a, billing.checkoutIdempotencyKey("u", "p", "cus_1", "https://b.vercel.app", t));
});

test("live key is refused on a Preview deployment", async () => {
  installSupabase(); const st = mockStripe();
  process.env.STRIPE_SECRET_KEY = "sk_live_dummy"; process.env.VERCEL_ENV = "preview";
  const r = await call(checkout({ stripe: st.api }), authed("POST"));
  assert.equal(r.code, 503);
  assert.equal(st.created.sessions, 0);
  process.env.VERCEL_ENV = "production";
  assert.equal(billing.liveKeyOutsideProduction(), false);
  delete process.env.VERCEL_ENV; process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});

test("stored customer from another Stripe account is ignored, new one created", async () => {
  const db = installSupabase(); const st = mockStripe(); const deps = { stripe: st.api };
  db.rows.push({ user_id: "user-anna", stripe_customer_id: "cus_from_old_account", stripe_subscription_id: "sub_old",
    status: "inactive", current_period_end: null, livemode: null, updated_at: "2026-11-05" });
  const r = await call(checkout(deps), authed("POST"));
  assert.equal(r.code, 200);
  assert.equal(st.created.customers, 1);
  const cs = Object.values(st.sessions)[0];
  assert.notEqual(cs.customer, "cus_from_old_account");
  // after payment the row is replaced with the real live data
  st.pay(cs.id);
  await call(webhook(deps), evt("checkout.session.completed", st.sessions[cs.id]));
  assert.equal(db.rows[0].status, "active");
  assert.equal(db.rows[0].stripe_customer_id, cs.customer);
});
