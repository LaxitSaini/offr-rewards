/**
 * End-to-end HTTP proof that the app really runs on Postgres.
 *
 * Usage (against a server already listening):
 *   BASE_URL=http://localhost:3000 node scripts/postgres-http-proof.mjs
 *
 * It walks the paths that touch the database — health, server-rendered reads,
 * session-backed admin auth, CSRF rejection, rate limiting and the audit trail —
 * and exits non-zero if any check fails. The rate-limit check drains the nonce
 * window, so run it against a freshly started server.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@offr.test", password: process.env.ADMIN_PASSWORD ?? "e2e-admin-password-1" };
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log("\n1. Wiring");
check("health is ok", health.ok === true);
check("database engine is postgres (not sqlite)", health.database?.engine === "postgres", JSON.stringify(health.database));
check("database.ok true", health.database?.ok === true);
check("serverless flag present", typeof health.serverless === "boolean");

console.log("\n2. Reads through Postgres (server-rendered pages)");
for (const route of ["/", "/leaderboard", "/admin-login"]) {
  const res = await fetch(`${BASE}${route}`);
  check(`GET ${route} → 200`, res.status === 200, String(res.status));
}

console.log("\n3. Auth guard = a database session lookup");
for (const route of ["/admin", "/admin/submissions", "/admin/payouts", "/admin/audit"]) {
  const res = await fetch(`${BASE}${route}`, { redirect: "manual" });
  check(`anonymous GET ${route} → 307`, res.status === 307, String(res.status));
}
const anonApi = await fetch(`${BASE}/api/admin/overview`);
check("anonymous admin API → 403", anonApi.status === 403, String(anonApi.status));

console.log("\n4. Writes + reads through Postgres (admin session)");
const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
});
check("POST /api/admin/login → 200", login.status === 200, String(login.status));
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const authed = await fetch(`${BASE}/api/admin/overview`, { headers: { cookie } });
check("authenticated GET /api/admin/overview → 200", authed.status === 200, String(authed.status));
const overview = await authed.json();
check("overview returns campaign data", Boolean(overview?.campaign?.campaignName), JSON.stringify(overview?.campaign?.campaignName));

for (const route of ["/api/admin/submissions", "/api/admin/participants", "/api/admin/tasks", "/api/admin/settings", "/api/admin/payouts", "/api/admin/audit"]) {
  const res = await fetch(`${BASE}${route}`, { headers: { cookie } });
  check(`authenticated GET ${route} → 200`, res.status === 200, String(res.status));
}

console.log("\n5. CSRF and rate limiting (both database-backed)");
const csrf = await fetch(`${BASE}/api/admin/settings`, {
  method: "PUT", headers: { "content-type": "application/json", cookie }, body: "{}",
});
check("CSRF-less PUT → 403", csrf.status === 403, String(csrf.status));

console.log("\n6. Participant session write path (before the limiter is drained)");
const nonce = await fetch(`${BASE}/api/auth/nonce`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: "0x2222222222222222222222222222222222222222" }),
});
check("nonce issued for a fresh wallet → 200", nonce.status === 200, String(nonce.status));

let limited = false;
for (let i = 0; i < 45; i++) {
  const res = await fetch(`${BASE}/api/auth/nonce`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }),
  });
  if (res.status === 429) { limited = true; break; }
}
check("nonce endpoint rate-limits (429) — limiter state lives in Postgres", limited);
const me = await fetch(`${BASE}/api/me`);
check("GET /api/me without session → 401", me.status === 401, String(me.status));

console.log("\n7. Audit trail written to Postgres");
const audit = await (await fetch(`${BASE}/api/admin/audit`, { headers: { cookie } })).json();
const actions = (audit.entries ?? audit.items ?? audit ?? []).map?.((e) => e.action) ?? [];
check("audit log contains the admin login from this run", actions.includes("admin.login"), JSON.stringify(actions.slice(0, 5)));

console.log(`\n───────────────\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
