# Deploy OFFR Rewards for $0, without a credit card

The card prompt you hit on Render comes from one line in the paid blueprint: a **persistent disk**.
Disks are a paid feature, so the service is switched to a paid instance type the moment a disk is
attached. Everything else in this app can run on free tiers.

**The fix is a database swap, not a rewrite:** keep the web app on a free host and put the data in a free
managed PostgreSQL database. The application already supports this — SQLite was the default, Postgres
was the alternative, and this branch makes the free path first-class.

---

## 1. What is genuinely free in 2026 (checked 2026-11-03)

| Platform | Card required | Free allowance | Catch that matters here |
| --- | --- | --- | --- |
| **Neon** (Postgres) | **No** | 0.5 GB storage, 100 CU-hours/month per project, built-in PgBouncer pooling, 6 h point-in-time restore, scales to zero after ~5 min idle | Compute is limited: a dormant database resumes in ~1 s, and 100 CU-hours is roughly "on for a few hours a day" at the smallest size |
| **Render** (web service) | **No** | 750 instance-hours/month, 512 MB / 0.1 CPU, free TLS + subdomain, 2 custom domains | Spins down after 15 min idle; first visitor waits **30–60 s**. No disk on free (hence this document) |
| **Vercel** (Hobby) | **No** | 100 GB transfer, ~1 M invocations, function duration up to 300 s on current projects, free custom domain + TLS | **Hobby is licence-restricted to non-commercial personal use.** Advertising a product or token counts as commercial in Vercel's fair-use wording |
| **Supabase** (Postgres) | No | 500 MB database | Also offered as the Postgres provider if you prefer it; only the connection string changes |

Two honest conclusions:

1. **Vercel + Neon is technically the best free runtime** (no cold-start penalty on the app itself, only
   Neon's ~1 s resume) — but Vercel's terms restrict Hobby to non-commercial projects. A public token
   campaign is best treated as commercial, so use Vercel for the **beta/smoke test** if you want speed,
   and put the public campaign on **Render free + Neon free**, which carries no such restriction.
2. **Neither free tier is a production SLA.** Render says outright that free instances are for
   evaluation; Neon's free compute quota can pause the database. For a 10–20 day campaign with a few
   hundred participants this is workable. If payouts become significant money, budget $7/month for a
   Render Starter instance so the site never sleeps.

---

## 2. Fastest path: Neon (5 min) + Render free (5 min)

### 2.1 Create the database (Neon, no card)

1. <https://neon.tech> → sign in with GitHub/Google → **Create project**.
2. Pick the region closest to your audience (e.g. Frankfurt or Ohio). Remember it: the web service should
   live in the same region.
3. On the project dashboard press **Connect** and copy the **pooled** connection string
   (the host contains `-pooler`). It looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. Keep it on screen for the next step. Do not paste it into a chat, an issue or a commit.

### 2.2 Deploy the app (Render, no card)

1. <https://render.com> → sign in with GitHub → **New → Blueprint** → select this repository → **Apply**.
2. Render reads `render.yaml` from this repo. It is the **free, no-disk** definition: free instance,
   `npm ci --include=optional --ignore-scripts && npm run build`, `npm start`, health check
   `/api/health`, no disk.
3. When prompted, fill the `sync: false` values:
   - `DATABASE_URL` → the Neon **pooled** string from step 1.3
   - `NEXT_PUBLIC_APP_URL` → `https://<service-name>.onrender.com` (update after adding a custom domain)
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` → your bootstrap admin (delete the password after first login)
   - `BASE_RPC_URL`, Telegram, X, `TEAM_WALLET_ADDRESS` → optional; leave blank to use the public Base RPC
     and the manual-review fallbacks
   - Leave `TOKEN_DECIMALS` **empty** so decimals are read from the contract
4. **Create** → wait for **Live** (first build ≈ 3–5 min).
5. Open `https://<service>.onrender.com/api/health`. Expect:

```json
{ "ok": true, "database": { "ok": true, "engine": "postgres" }, "serverless": false,
  "chain": { "mode": "live", "metadataLive": true } }
```

`metadataLive:false` = the RPC is unreachable (set a paid/alternative `BASE_RPC_URL`).
`database.engine:"none"` or a 503 means `DATABASE_URL` is missing or wrong — the response now includes a
sanitised reason (`database.error`) instead of hiding it.

### 2.3 First five minutes as admin

Exactly as in [LAUNCH.md](./LAUNCH.md) section B: sign in at `/admin-login`, change the password, delete
`ADMIN_PASSWORD` from Render, set the campaign window/budget/caps, run the ten-row proof table, then open
signup.

---

## 3. Alternative: Vercel + Neon (fastest cold start)

Use this if the campaign qualifies as **non-commercial**, or for the beta smoke test.

1. Neon project + pooled connection string (section 2.1).
2. <https://vercel.com> → **Add New → Project** → import this repository.
3. `vercel.json` in the repo sets the framework, the install command
   (`npm ci --include=optional --ignore-scripts`, so the unused SQLite driver is never compiled), a 60 s
   `maxDuration` for API routes, and `no-store` on `/api/*`.
4. **Environment Variables** (Production *and* Preview):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (`...-pooler...?sslmode=require`) |
| `PG_POOL_MAX` | `1` (one connection per serverless invocation; this is the default when the app detects Vercel) |
| `NEXT_PUBLIC_APP_URL` | `https://<project>.vercel.app` (then your real domain) |
| `CHAIN_MODE` | `live` |
| `BASE_RPC_URL` | optional, e.g. a free Alchemy/QuickNode Base URL |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | bootstrap admin, delete after rotation |
| `TELEGRAM_*`, `X_BEARER_TOKEN`, `TEAM_WALLET_ADDRESS` | optional |

5. **Deploy**, then open `/api/health`: `"serverless": true`, `"database": {"engine":"postgres","ok":true}`.
6. Set the function region to the same region as your Neon project (Project → Settings → Functions).

Nothing else is required: every page that touches data is `force-dynamic`, so the build never queries the
database, and no route writes to the filesystem.

---

## 4. What changed in the code so this is safe (not just possible)

| Area | Behaviour on a serverless/Postgres host |
| --- | --- |
| **Storage** | `DATABASE_URL` selects Postgres. On a serverless host with no `DATABASE_URL` the app now **refuses** instead of silently writing to an ephemeral SQLite file that vanishes on the next cold start. |
| **Migrations** | Applied automatically on first database access, idempotent, conflict-tolerant (`schema_migrations` + `ON CONFLICT DO NOTHING`), so concurrent cold starts are safe. Postgres migrations are proven in `tests/postgres-services.test.ts`. |
| **Connection pooling** | `prepare: false` (PgBouncer/Neon pooler compatible), `max = 1` on serverless (protects the free connection limit), short idle timeout, and a failed connection is not cached — fixing `DATABASE_URL` in the dashboard recovers without a redeploy. |
| **Rate limiting** | Already **database-backed**, so limits hold across serverless instances instead of resetting per lambda. Proven on Postgres. |
| **Sessions** | Stored as hashed tokens in the database, so a login survives redeploys, cold starts and instance fan-out. |
| **Reward accounting** | Approval is a single-statement compare-and-set; referral credit is an atomic claim; payouts go through one `INSERT … SELECT … WHERE` budget/per-wallet gate. All three are executed against a real Postgres engine in `tests/postgres-services.test.ts` (including two concurrent approvals → exactly one wins). |
| **Chain access** | Unchanged and read-only; `TOKEN_DECIMALS` stays unset so decimals come from the contract. |
| **Filesystem** | Nothing writes to disk except the SQLite adapter, which is not used on these hosts. |

---

## 5. Free-tier limits you should know before the campaign

- **Render free sleeps after 15 min idle**, waking in 30–60 s. Post on X/Telegram *before* sharing the
  link, or accept that the first visitor waits. Health checks every 5–15 min keep it warm only if your
  Render plan allows it (free instances do not run health checks while spun down).
- **Neon free scales to zero after ~5 min**; the first query after that pays a ~1 s resume. 100 CU-hours
  per month is the real budget — a site with steady traffic stays inside it at the smallest compute size,
  but a bot crawl could burn it.
- **5 GB bandwidth/month on Render free**, 100 GB on Vercel Hobby.
- **Backups:** Neon free includes ~6 h point-in-time restore. Take a manual logical backup before the
  first real payout batch (see §6). `npm run db:backup` is SQLite-only and will tell you so.
- **No custom domain on Render free?** Two custom domains are included; TLS is automatic.
- **Vercel Hobby:** non-commercial only. Do not run a paid promotion on it.

---

## 6. Backups on Postgres

`npm run db:backup` refuses on Postgres by design (a file copy of a remote database is meaningless).
Use one of:

```bash
# From any machine with network access and psql installed
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f offr-$(date +%F).dump
pg_restore --clean --if-exists -d "$DATABASE_URL" offr-YYYY-MM-DD.dump   # restore
```

Neon's dashboard also offers **Branches → Restore** for the built-in 6-hour window. Store dumps somewhere
that is not the same account (phone storage, Drive, object storage).

---

## 7. Verification checklist for the deployed free instance

Run these against the live URL and paste the results into the campaign log:

| # | Check | Expected |
| --- | --- | --- |
| 1 | `GET /api/health` | `ok:true`, `database.engine:"postgres"`, `chain.metadataLive:true` |
| 2 | `GET /admin` in a private window | `307` to `/admin-login` (never admin pages) |
| 3 | `POST /api/admin/overview` with no cookie | `403` |
| 4 | Admin login → hard refresh | Session survives (cookie + DB row) |
| 5 | Participant: connect wallet → sign → dashboard | Real OFFR balance with a Base block number |
| 6 | Submit a task → approve in admin | Points credited once; second approval refused |
| 7 | Leaderboard | Same points as the dashboard |
| 8 | Record a payout with a wrong hash | Refused with a reason, not silently accepted |
| 9 | Redeploy / restart the service | Data still there (this is the whole point of Postgres) |
| 10 | `/admin/audit` | Every action above is listed |

Local equivalent (no hosting account needed) for the database layer:
`npx vitest run tests/postgres-services.test.ts tests/postgres-compat.test.ts`.

---

## 8. What is NOT verified here

- No deployment was performed from this sandbox (no hosting credentials). Everything above is verified at
  the code/test level plus a clean local production build.
- The Postgres path is proven against a real Postgres engine (PGlite) through the application's own
  adapter, services and migrations — **not** against a hosted Neon endpoint. TLS, PgBouncer transaction
  mode, cold-start latency and Neon quotas need the deployed smoke test in §7.
- Render free cold-start behaviour and Vercel function limits come from the providers' published
  documentation (checked 2026-11-03), not from a measurement taken here.
