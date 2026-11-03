# Deployment guide

The app is a standard Next.js 15 application with one Node process. Two supported shapes:

| Shape | Database | Best for |
| --- | --- | --- |
| A. Vercel (or any serverless host) + managed Postgres | `DATABASE_URL=postgresql://…` | Fastest setup, free tiers (Neon/Supabase), no server to babysit |
| B. Railway / Render / Fly / small VM with a volume | `SQLITE_PATH=/data/offr.db` | Cheapest for a 10–20 day campaign, single instance, no external DB |

### Which shape should you pick?

**Recommended for the first launch: Shape B (Railway/Render/Fly + SQLite on a volume).**
It is the path whose engine is actually covered by the test evidence: the 98 unit/integration tests and
the 83-assertion HTTP suite all run against SQLite, so a launch on Shape B has no unexercised storage
layer. It is also the cheapest, and a 10–20 day campaign on one instance fits it comfortably.

**Shape A (Vercel + Neon) is fully implemented and is the better long-term choice** if you need
serverless resilience, automatic scaling or managed backups. The caveat is honest: the Postgres SQL is
verified against an in-process Postgres engine (`tests/postgres-compat.test.ts` — migrations, `?`→`$n`
placeholders, partial unique indexes, the atomic payout gate), but **no hosted Postgres, connection
pooler or TLS path has been exercised here**. If you choose Shape A, do one supervised deploy and smoke
test (section 6) before the campaign opens, and keep `PG_POOL_MAX` modest behind a pooler.

Either way the schema, seed data and application behaviour are identical.

Everything below can be done from an Android phone in a mobile browser. You do **not** need a laptop,
a terminal emulator or a desktop wallet to deploy — only to *test* when you want CLI convenience
(section 9 shows the optional Termux commands, which mirror the browser steps exactly).

---

## 0. Deploy from an Android phone (browser only)

This walkthrough deploys **Shape A** (Vercel + Neon) because it is the one that needs no server
administration. **Shape B** — the recommended first launch — is the same idea on Railway/Render: import
the repo, attach a volume mounted at `/data`, set `SQLITE_PATH=/data/offr.db`, and use the env checklist
in section 2 unchanged (skip `DATABASE_URL`). Either way, finish with section 6's verification.

You need three free accounts: **GitHub**, **Vercel**, **Neon** (Postgres). Use Chrome/Firefox on the
phone; all three dashboards are usable at phone width, and the "desktop site" toggle helps for
Neon's SQL editor if you need it.

1. **Get the code onto GitHub** — the repository already has `main`. Deploy from `main`; any pending
   fix branch must be reviewed and merged first (see the pull request's verification report).
2. **Create the database (Neon, ~3 minutes)**
   - neon.com → *New Project* → region closest to your users (e.g. `aws-eu-central-1`).
   - Copy the **pooled** connection string (it contains `-pooler`). It looks like
     `postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   - Keep it in a notes app — it is a secret. Do not paste it into chats, screenshots or GitHub.
3. **Import the repo into Vercel**
   - vercel.com → *Add New… → Project* → *Import Git Repository* → pick `offr-rewards`.
   - Framework preset: **Next.js** (auto-detected). Build command and output stay default.
4. **Add environment variables** (Vercel → *Settings → Environment Variables*, one per row).
   Copy values from the checklist in section 2. At minimum:
   `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `CHAIN_MODE=live`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD` (temporary). `TRUST_PROXY` is auto-detected on Vercel.
5. **Deploy** → wait for "Building" to finish. Vercel gives you `https://<project>.vercel.app`.
6. **Point the app at its own URL** — set `NEXT_PUBLIC_APP_URL` to the exact `https://…vercel.app`
   origin (or your custom domain) and redeploy once, so metadata, CORS-free fetches and links agree.
   From the phone: *Settings → Environment Variables → edit → Save → Deployments → ⋯ → Redeploy*.
7. **First request = first migration.** Open `https://<project>.vercel.app/api/health`. The app applies
   all migrations and seeds the campaign catalogue on the first request; `ok:true` plus
   `db:{dialect:"postgres"}` confirms it.
8. **Create the admin.** Open `/admin-login` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
   The plaintext password is hashed with scrypt on first login and never stored. Immediately after,
   rotate it (section 4) and delete `ADMIN_PASSWORD` from Vercel.
9. **Verify the token reads.** `/api/health` must show `chain.metadataLive: true`. If it is `false`,
   the RPC is unreachable from Vercel — set `BASE_RPC_URL` to an Alchemy/QuickNode Base mainnet URL.
10. **Add the Telegram webhook** (section 5) once `TELEGRAM_BOT_TOKEN` and
    `TELEGRAM_WEBHOOK_SECRET` are set, then reload `/dashboard` on the phone and connect Telegram.

> **Do not send real OFFR** until section 10's checklist is fully ticked and you have recorded a
> small test payout end-to-end.

---

## 1. Database

### A. Managed PostgreSQL (recommended for Vercel)
1. Create a free Neon (or Supabase) project and copy the **pooled** connection string.
2. Set `DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"`.
3. `npm run db:migrate` runs them explicitly; the first HTTP request also migrates automatically.
   Both are idempotent and safe to repeat.

### B. SQLite on a persistent disk
1. Mount a volume (e.g. `/data`) on Railway/Render/Fly.
2. Set `SQLITE_PATH=/data/offr.db`.
3. Run `npm run db:migrate` during the first deploy (release command or one-off shell).
4. Ensure **only one instance** writes to the file (SQLite + multiple replicas = corruption).

Both paths share the same schema (`src/lib/db/migrations.ts`), which only uses SQL that exists in both
engines. Timestamps are stored as epoch milliseconds and booleans as `0/1` for portability.
**Verification status:** the SQLite path is exercised by the full test suite and the E2E run; the
Postgres path is executed against an in-process Postgres engine (PGlite) in
`tests/postgres-compat.test.ts`, but has **not** been run against a hosted Postgres instance or
through a connection pooler in this environment. Treat the first Neon deploy as a supervised step.

---

## 2. Environment checklist

Copy this table into your notes and tick each value as you add it in Vercel.

| Variable | Required? | Example / where it comes from | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | **yes** | `https://rewards.example.com` | Public origin; must be `https`. Used in links and messaging. |
| `DATABASE_URL` | one of | `postgresql://…?sslmode=require` | Enables Postgres. Omit to use SQLite. |
| `SQLITE_PATH` | one of | `/data/offr.db` | Only for a single instance with a persistent disk. |
| `BASE_RPC_URL` | **yes** | `https://mainnet.base.org` | Public endpoint is rate-limited; Alchemy/QuickNode recommended for production. |
| `CHAIN_MODE` | **yes** | `live` | `mock` is refused when `NODE_ENV=production`. |
| `TOKEN_DECIMALS` | no | `18` | Leave unset so decimals are read from the contract. Set only as a documented incident workaround. |
| `ADMIN_EMAIL` | **yes** (bootstrap) | `team@offr.xyz` | First admin. Case-insensitive. |
| `ADMIN_PASSWORD` | **yes** (bootstrap) | 12+ chars, letters + numbers | Delete after the password is rotated. |
| `ADMIN_SESSION_HOURS` | no | `8` | Clamped to 1–168. |
| `TEAM_WALLET_ADDRESS` | strongly recommended | `0x…` official payout wallet | Must be 40 hex chars or the app refuses to start. Restricts verified payouts to transfers from this wallet. |
| `TRUST_PROXY` | optional | `1` | Auto-enabled on Vercel/Fly/Railway/Render (they overwrite `X-Forwarded-For`). Set `0` to force it off, `1` for any other reverse proxy. |
| `TELEGRAM_BOT_TOKEN` | optional | @BotFather | Enables automatic membership checks. |
| `TELEGRAM_CHAT_ID` | optional | `-100…` or `@offrchat` | Bot must be an admin of that chat. |
| `TELEGRAM_BOT_USERNAME` | optional | `OffrRewardsBot` | Used to build `t.me` links. |
| `TELEGRAM_WEBHOOK_SECRET` | optional | random 32+ chars | Only for webhook mode; the route rejects all calls without it. |
| `X_BEARER_TOKEN` | optional | X developer portal (app-only) | Enables API verification of submitted posts. Follow checks stay manual. |
| `X_ACCOUNT_HANDLE` | optional | `OFFR35` | Official handle used in copy and checks. |
| `RATE_LIMIT_DISABLED` | never in prod | `1` | Ignored when `NODE_ENV=production`. |
| `ALLOW_IFRAME_EMBED` | no | `1` | Sandbox previews only. Leave unset in production (`frame-ancestors 'none'`). |

Generate the admin hash before go-live so the plaintext env var can be removed afterwards:

```bash
npm run admin:hash -- --email team@offr.xyz --password 'your-password'
# then delete ADMIN_PASSWORD from the environment
```

Secrets live only in the hosting dashboard. Nothing in the repo contains a real key, token or
password; `.env.example` documents every variable with empty values.

---

## 3. Deploy

### Vercel (phone-friendly: use the dashboard, or the CLI below)
```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production
vercel env add BASE_RPC_URL production
vercel env add ADMIN_EMAIL production
vercel env add ADMIN_PASSWORD production
vercel env add TRUST_PROXY production   # optional: auto-detected on Vercel
vercel --prod
```
Notes:
- `better-sqlite3` is only loaded when `DATABASE_URL` is absent; with Postgres configured, the native
  module is never imported at runtime, so a failed native build cannot break the deploy.
- Install it with `npm ci --include=optional --ignore-scripts`. Without `--include=optional` npm skips it
  (it is an optional dependency). With scripts enabled npm runs `node-gyp rebuild`, which fails on hosts
  that cannot reach the Node header mirror — and npm then removes the optional package **without failing
  the install**, so the deploy looks green and 500s on every page. `--ignore-scripts` uses the published
  prebuild instead; the `node -e "require('better-sqlite3')"` check keeps that honest.
- Route handlers run on the Node runtime and are marked dynamic — no static caching of user data.
- `serverExternalPackages` in `next.config.ts` keeps `postgres` out of the bundler.

### Render (recommended Shape B — exact settings)

Two Blueprints are in the repository root:

- **`render.yaml` — free instance + hosted Postgres.** No card. This is the default; the full walkthrough
  is [DEPLOYMENT-FREE.md](./DEPLOYMENT-FREE.md).
- **`render-paid.yaml` — Starter instance + SQLite on a persistent disk.** Requires a card (disks are paid).
  The table below describes this variant.

In the Render dashboard: **New → Blueprint → select this repo → Apply**. Render prompts for every
`sync: false` secret once; it stores them encrypted and never shows them again.

| Render field | Exact value | Why |
| --- | --- | --- |
| Service type | **Web Service**, runtime **Node** | Next.js needs a persistent process |
| Repository / branch | your repo / `main` | `main` is the reviewed branch |
| Root directory | *(empty — repository root)* | `package.json` is at the root |
| Instance type | **Starter or larger** | a persistent disk is not available on Free |
| Region | any single region (e.g. Oregon) | keep it near your RPC/audience |
| Build command | `npm ci --include=optional --ignore-scripts && node -e "require('better-sqlite3')" && npm run build` | `--include=optional` is **required** (npm skips the optional driver otherwise → every page 500). `--ignore-scripts` is **required** too: `better-sqlite3` ships a prebuilt binary, but its `node-gyp rebuild` script fails wherever the Node header mirror is unreachable and npm then drops the optional package **silently**. The `node -e require(...)` step turns that into a failed build instead of a broken deploy. |
| Start command | `npm start` | runs `next start -H 0.0.0.0 -p $PORT` |
| Health check path | `/api/health` | returns `200` only when the database answers, `503` otherwise |
| Disk | name `offr-data`, mount path **`/var/data`**, **1 GB** | SQLite file lives here, not in the ephemeral container |
| Env: `SQLITE_PATH` | `/var/data/offr.db` | must match the mount path |
| Env: `CHAIN_MODE` | `live` | `mock` is refused at boot in production |
| Env: `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` | session cookies are `Secure` in production |
| Env: `NODE_VERSION` | `22.14.0` (>= 20.11 required) | `engines` in `package.json` |

Secrets that must be set in **Render → Environment** (never in git, never in this repo):
`BASE_RPC_URL` (optional, defaults to `https://mainnet.base.org`), `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` (`generateValue` in the Blueprint), `X_BEARER_TOKEN`,
`TEAM_WALLET_ADDRESS`, `ADMIN_EMAIL` + `ADMIN_PASSWORD` (bootstrap only — delete both after the first
login), and `TOKEN_DECIMALS` **left empty** so decimals are read from the contract.

**Migrations.** `src/lib/db/index.ts` applies every migration on first database access, so the first
health check after a deploy creates/updates the schema. To run them explicitly from the Render Shell:
`npm run db:migrate` (idempotent; safe to repeat).

**Persistence check after the first deploy.** In the Render Shell:

```bash
ls -l /var/data/offr.db            # the database must live on the mount
npm run db:backup                  # writes /var/data/backups/offr-<timestamp>.db + integrity check
```

Then trigger **Manual Deploy → Restart** and confirm `/api/health` still returns `ok:true` and your
admin login still works: both prove the disk survived the restart (the session row is in the database).
If `/var/data/offr.db` is missing after a restart, the disk is not mounted at `/var/data` — stop and fix
that before inviting anyone.

**Backup and recovery.**
- Automated: enable your host's disk snapshot/scheduled-job feature and run `npm run db:backup` daily
  (Render → Cron Job, or the Shell while the campaign runs). The script verifies `PRAGMA integrity_check`
  on every copy and keeps the newest `KEEP` files (default 14).
- Manual restore: stop the service, copy a verified backup over the live file
  (`cp /var/data/backups/offr-<ts>.db /var/data/offr.db`), start the service, then check `/api/health`
  and the overview counts. Restore drills are covered in section 6.
- Postgres deployments: use the provider's PITR/snapshot feature; `npm run db:backup` refuses and says so.

### Railway / Fly / VM
1. Build: `npm ci --include=optional --ignore-scripts && node -e "require('better-sqlite3')" && npm run build`
2. Start: `npm start` (binds `0.0.0.0:$PORT`)
3. Migration: applied automatically on first request; `npm run db:migrate` to run it explicitly.
4. Attach a volume and set `SQLITE_PATH` to a path **on** that volume if you are not using Postgres.
5. `TRUST_PROXY` is detected automatically on Railway/Render/Fly; set `TRUST_PROXY=1` explicitly for any other reverse proxy.

---

## 4. Rotate the admin password (do this on day one)

1. Sign in at `/admin-login`.
2. Change the password in the admin UI (or run `npm run admin:hash -- --email … --password …` and put
   the resulting hash where the operator runbook keeps it — the app stores only hashes).
3. Delete `ADMIN_PASSWORD` from the hosting environment. Leaving it set means anyone who empties the
   `admins` table could re-provision the bootstrap account.
4. The app logs a warning at boot while `ADMIN_PASSWORD` is still present in production.

---

## 5. Telegram webhook (production)

Polling works out of the box, but a webhook is more reliable on serverless hosts:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://rewards.example.com/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

The webhook route rejects every request unless the `X-Telegram-Bot-Api-Secret-Token` header matches
(constant-time compare), only links accounts from `/start <token>` messages received in a private
chat, and scopes membership updates to the configured campaign chat.
If a webhook is registered, `/api/telegram/link/poll` reports that polling is disabled and membership is
still confirmed by the webhook.

From a phone without a terminal, you can paste that URL into any browser — Telegram's API answers with
JSON, and `{"ok":true,"result":true,"description":"Webhook was set"}` is the success case.

---

## 6. Post-deploy verification

Open these in the phone browser, in order:

| URL | Expected |
| --- | --- |
| `/api/health` | `ok:true`, `chain.mode:"live"`, `chain.metadataLive:true`, `db.dialect:"postgres"` |
| `/` | Marketing page with live task cards and the OFFR identity |
| `/leaderboard` | Loads (empty until participants sign in) |
| `/admin-login` | Admin form (no data visible) |
| `/dashboard` without a wallet | Prompts to connect; no participant data leaks |

Then walk through, with a real wallet, on Base mainnet:

1. Connect a wallet on the wrong network → the app offers to switch/add Base and refuses otherwise.
2. Sign in → `/dashboard` loads with the real OFFR balance on **Verify balance**.
3. Submit an X post → the verification badge shows "Verified" only when `X_BEARER_TOKEN` is set;
   otherwise it is queued for manual review and says so.
4. Connect Telegram → the bot replies and the claim becomes verified (or falls back to manual review
   when the bot credentials are missing — the UI then offers a `@username` form).
5. Admin: approve a claim → points appear on the participant dashboard.
6. Admin: record a payout **without** a hash → status `recorded`; send the transfer manually and add the
   hash on re-verification → status `verified` only if a matching OFFR `Transfer` to that wallet exists
   in the receipt (and, when `TEAM_WALLET_ADDRESS` is set, only if the transfer originates there).

---

## 7. Troubleshooting

**`/api/health` shows `database.ok:false` on a SQLite host.** The optional native driver was skipped
during install. Run `npm run check:db` (it prints the diagnosis), then
`npm ci --include=optional --ignore-scripts` — and keep the `node -e "require('better-sqlite3')"` step
after it, because npm drops the optional package silently when its native rebuild fails. Postgres
deployments never need this driver; if `DATABASE_URL` is set the driver is not loaded at all.

**`chain.metadataLive:false`.** The RPC is unreachable from the host. Set `BASE_RPC_URL` to an
Alchemy/QuickNode Base mainnet URL and reload. Balances reflect this: the app refuses to show a fake
zero balance and tells the participant verification is unavailable.

**Admin login says "invalid credentials" but the password is right.** The account is created on the
first login from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, and only if the password passes the policy (12+ chars,
letters and numbers) and the `admins` table is empty. Check the server log for
`[admin] ADMIN_PASSWORD does not meet policy`.

**Telegram claims stay "manual".** Bot credentials are missing or the bot is not an admin of the
configured chat; `getChatMember` then fails and the app queues the claim for manual review by design.

---

## 8. Backups

- Postgres (Neon): enable point-in-time restore on the project; take a manual snapshot before the first
  payout batch.
- SQLite: `npm run db:backup` (online backup + `PRAGMA integrity_check` + retention pruning) writes
  `<db dir>/backups/offr-<timestamp>.db`. Schedule it daily on the host, and copy the file off the host
  (object storage, or download it from the Render Shell) — a volume snapshot protects against a bad
  deploy, an off-host copy protects against losing the volume.

---

## 9. Optional: command line from the phone (Termux)

The browser steps above are sufficient. If you prefer a terminal on Android, the mirrors are:

```bash
pkg install nodejs git curl            # Termux
git clone https://github.com/LaxitSaini/offr-rewards && cd offr-rewards
npm ci --include=optional
npm run typecheck && npm test          # 98 tests
npm run build
curl -s https://rewards.example.com/api/health
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`npx tsx scripts/e2e.ts` needs a running server; run it against a mock-mode local instance only, never
against the production deployment. `node scripts/ui-audit.mjs` renders every route server-side and
reports contrast, heading, landmark, label and tap-target problems; it needs the same local instance.

---

## 10. Go-live checklist

- [ ] `CHAIN_MODE=live` and `/api/health` shows `chain.metadataLive: true`
- [ ] `TOKEN_DECIMALS` unset (read from chain) unless a documented incident requires the override
- [ ] `TRUST_PROXY` correct for the host: auto-detected on Vercel/Fly/Railway/Render, `1` for other
      reverse proxies, so rate limits key on real client IPs rather than one shared bucket
- [ ] Admin password rotated; `ADMIN_PASSWORD` removed from the environment
- [ ] `TEAM_WALLET_ADDRESS` set to the official payout wallet (malformed values refuse to boot)
- [ ] Campaign settings reviewed in **Admin → Settings**: window, budget, OFFR-per-point, per-user cap,
      points cap, holding rule, referral points
- [ ] Tasks and weights reviewed; inactive tasks disabled
- [ ] `TELEGRAM_*` and `X_BEARER_TOKEN` configured (or the UI clearly falls back to manual review)
- [ ] `NEXT_PUBLIC_APP_URL` matches the real `https://` domain
- [ ] `npm run check:db` reports a healthy database on the deploy host
- [ ] Database backed up before the campaign; daily snapshot during it
- [ ] A small test payout recorded and verified end-to-end before the first real batch
- [ ] `ALLOW_IFRAME_EMBED` **unset** in production
- [ ] `RATE_LIMIT_DISABLED` absent

---

## 11. Operations during the campaign (10–20 days)

- Review the queue daily: **Admin → Review queue**. Approving credits points instantly; the participant sees
  the status change on refresh. Two reviewers clicking approve at the same moment cannot double-credit —
  the second request gets a 409 and nothing is written.
- Payouts can be recorded in batches. Each record is checked against the remaining budget and the
  per-participant cap *inside the insert*, so parallel payouts cannot overspend; a payout cannot be
  marked paid without on-chain evidence.
- Watch **Admin → Overview** for budget utilisation and integration status.
- Everything is written to **Admin → Audit log** — useful if a participant disputes a decision.
- To pause intake: **Settings → Submissions open: off**. Existing claims can still be reviewed.
