# Deployment guide

The app is a standard Next.js 15 application with one Node process. Two supported shapes:

| Shape | Database | Best for |
| --- | --- | --- |
| A. Vercel (or any serverless host) + managed Postgres | `DATABASE_URL=postgresql://…` | Fastest setup, free tiers (Neon/Supabase) |
| B. Railway / Render / Fly / small VM with a volume | `SQLITE_PATH=/data/offr.db` | Cheapest for a 10–20 campaign day run, no external DB |

---

## 1. Database

### A. Managed PostgreSQL (recommended for Vercel)
1. Create a free Neon (or Supabase) project and copy the pooled connection string.
2. Set `DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"`.
3. Run migrations once: `npm run db:migrate` (also runs automatically on first request).

### B. SQLite on a persistent disk
1. Mount a volume (e.g. `/data`) on Railway/Render/Fly.
2. Set `SQLITE_PATH=/data/offr.db`.
3. Run `npm run db:migrate` during the first deploy (release command or one-off shell).
4. Ensure only one instance writes to the file (SQLite + multiple replicas = corruption).

Both paths share the same schema (`src/lib/db/migrations.ts`), which only uses SQL that exists in both
engines. Timestamps are stored as epoch milliseconds and booleans as `0/1` for portability.

---

## 2. Environment variables

Minimum for a working campaign:

```bash
NEXT_PUBLIC_APP_URL="https://rewards.example.com"

# database (choose one)
DATABASE_URL="postgresql://…"
# SQLITE_PATH="/data/offr.db"

BASE_RPC_URL="https://mainnet.base.org"   # or an Alchemy/QuickNode Base URL
CHAIN_MODE="live"

ADMIN_EMAIL="team@offr.xyz"
ADMIN_PASSWORD="<long unique password, 12+ chars>"
ADMIN_SESSION_HOURS="8"

TEAM_WALLET_ADDRESS="0x…your payout wallet…"   # strongly recommended
```

Optional integrations (see README §5): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `X_BEARER_TOKEN`, `X_ACCOUNT_HANDLE`.

Generate the admin hash before go-live so the plaintext env var can be removed afterwards:

```bash
npm run admin:hash -- --email team@offr.xyz --password 'your-password'
# then delete ADMIN_PASSWORD from the environment
```

---

## 3. Deploy

### Vercel
```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production
vercel env add BASE_RPC_URL production
vercel env add ADMIN_EMAIL production
vercel env add ADMIN_PASSWORD production
vercel --prod
```
Notes:
- `better-sqlite3` is only loaded when `DATABASE_URL` is absent; with Postgres configured, the native module
  is never imported at runtime.
- Route handlers run on the Node runtime and are marked dynamic — no static caching of user data.
- `serverExternalPackages` in `next.config.ts` keeps `postgres` out of the bundler.

### Railway / Render / Fly
1. Build: `npm ci && npm run build`
2. Start: `npm run start` (binds `0.0.0.0:$PORT`)
3. Release command: `npm run db:migrate`
4. Attach a volume and set `SQLITE_PATH` if you are not using Postgres.

Set `TRUST_PROXY=1` when behind the platform proxy so rate limiting sees real client IPs.

### Telegram webhook (production)
Polling works out of the box but a webhook is more reliable:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://rewards.example.com/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

The webhook route rejects every request unless the `X-Telegram-Bot-Api-Secret-Token` header matches.
If a webhook is registered, `/api/telegram/link/poll` reports that polling is disabled and membership is
still confirmed by the webhook.

---

## 4. Post-deploy verification

```bash
curl https://rewards.example.com/api/health
```

Expect `ok: true`, `chain.metadataLive: true` (real symbol/decimals read from the token contract) and
`integrations` reflecting which credentials are present.

Then walk through, with a real wallet, on Base mainnet:

1. Connect a wallet on the wrong network → the app should offer to switch/add Base and refuse otherwise.
2. Sign in → `/dashboard` loads with the real OFFR balance on **Verify balance**.
3. Submit an X post → confirm the verification badge shows “Verified” only when `X_BEARER_TOKEN` is set.
4. Connect Telegram → confirm the bot replies and the claim becomes verified.
5. Admin: approve a claim → points appear on the participant dashboard.
6. Admin: record a payout **without** a hash → status `recorded`; then send the transfer manually and add the
   hash via a new record or re-verify → status `verified` only if a matching OFFR `Transfer` to that wallet
   exists in the receipt (and, when `TEAM_WALLET_ADDRESS` is set, only if the transfer originates there).

---

## 5. Go-live checklist

- [ ] `CHAIN_MODE=live` and `/api/health` shows `chain.metadataLive: true`
- [ ] `TOKEN_DECIMALS` matches the contract (leave env unset to read it from chain)
- [ ] Admin password rotated; `ADMIN_PASSWORD` removed from the environment
- [ ] `TEAM_WALLET_ADDRESS` set to the official payout wallet
- [ ] Campaign settings: window, budget, rate, caps, holding rule — reviewed in **Admin → Settings**
- [ ] Tasks and weights reviewed; inactive tasks disabled
- [ ] `TELEGRAM_*` and `X_BEARER_TOKEN` configured (or the UI clearly falls back to manual review)
- [ ] `NEXT_PUBLIC_APP_URL` matches the real domain
- [ ] Database backed up before the campaign; daily snapshot during it
- [ ] Reward payouts tested with a small amount before the first real batch
- [ ] `ALLOW_IFRAME_EMBED` **unset** in production

---

## 6. Operations during the campaign (10–20 days)

- Review the queue daily: **Admin → Review queue**. Approving credits points instantly; the participant sees
  the status change on refresh.
- Payouts can be recorded in batches. Each record is capped by the remaining budget and the per-participant
  reward cap, and cannot be marked paid without on-chain evidence.
- Watch **Admin → Overview** for budget utilisation and integration status.
- Everything is written to **Admin → Audit log** — useful if a participant disputes a decision.
- To pause intake: **Settings → Submissions open: off**. Existing claims can still be reviewed.
