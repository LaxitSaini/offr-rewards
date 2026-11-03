# OFFR Rewards

The community campaign platform for **OFFLINE RESEARCH ($OFFR)** on **Base Mainnet** (chain ID `8453`).

Token contract: [`0xee9069e8f520652e59674fad2120f6dea2671ba3`](https://basescan.org/token/0xee9069e8f520652e59674fad2120f6dea2671ba3)
Official X: [@OFFR35](https://x.com/OFFR35) · Telegram: [t.me/OFFR77](https://t.me/OFFR77)

This is a working application, not a mockup: wallet-signature auth, server-side on-chain balance reads,
Telegram bot verification, X post verification, a review console with approvals, manual payout recording
with Base transaction verification, and a complete audit trail.

---

## 1. What it does

### Participant app
| Area | Behaviour |
| --- | --- |
| Wallet connect | Injected Base-compatible wallets (MetaMask, Coinbase Wallet, Rabby, Brave, OKX). Enforces chain ID 8453, offers `wallet_addEthereumChain` when Base is missing, never requests a seed phrase or private key. |
| Sign-in | EIP-191 message signature, verified server-side (EOA + ERC-1271 smart wallets). The exact signed message is persisted, single-use, 10-minute expiry. |
| Balance | OFFR `balanceOf` is read **server-side** from the token contract via RPC. The browser never supplies a balance. |
| Tasks | Telegram membership, X follow, original X post, meme, long-form content, on-chain holding, referral programme. Weights and limits are admin-editable. |
| Verification | Telegram Bot API `getChatMember`; X API v2 post lookup; server-side RPC balance with timestamped snapshots; automatic manual-review fallback whenever an integration is not configured. |
| Reward visibility | Points, rank, reward estimate with caps, holding progress, payout status with BaseScan links, complete submission + verification history. |
| Anti-abuse | One record per wallet, per-task content hashing (the same link/handle cannot be claimed twice, even across wallets), pending-claim blocking, referral self-referral and 24-hour window guards, IP-based risk flags, per-user and per-IP rate limits, one Telegram account per wallet. |

### Admin console (`/admin`)
- Overview: participants, pending queue, budget utilisation, task performance, integration status, recent activity.
- Review queue: proof, verification evidence (API/bot/on-chain/manual), approve with adjusted points, reject, revoke an approval.
- Participants: search, points, submissions, payouts, holding days, referral code, risk flags, block/unblock, internal notes.
- Payouts: record amount + Base tx hash, automatic on-chain verification (Transfer log from the OFFR contract to the participant), re-verify, void, budget and per-user cap enforcement.
- Tasks: create/edit weights, award caps, auto-verification mode, activation.
- Settings: campaign window, budget, rate, thresholds, caps, holding rules, referral limits, payout disclaimer.
- Audit log: append-only record of every admin/system action (actor, target, metadata, IP, timestamp).

---

## 2. Architecture

```
Browser (Next.js App Router, React 19, Tailwind)
   │  same-origin fetch + CSRF header
   ▼
Next.js route handlers (Node runtime)
   ├── auth: nonce → signature verify (viem) → DB session + CSRF token
   ├── services: rewards, submissions, holdings, payouts, telegram, x, dashboard
   ├── chain: viem public client → Base RPC (server-side only)
   └── db: dialect-neutral SQL (SQLite or PostgreSQL)
```

- **Framework:** Next.js 15 (App Router), TypeScript strict, Tailwind CSS.
- **Database:** SQLite (`better-sqlite3`, an *optional* dependency loaded at runtime) for a single-VM deployment, or PostgreSQL (`postgres`) for managed hosting. One portable SQL layer; migrations live in `src/lib/db/migrations.ts`. If the native SQLite build is unavailable, installation still succeeds and only SQLite deployments need it — Postgres users are unaffected.
- **Chain access:** `viem` with `BASE_RPC_URL`. No private keys are ever held by the app — payouts are sent manually by the team from their own wallet, then verified from the hash.
- **Auth:** DB-backed sessions (only a SHA-256 of the cookie token is stored), `httpOnly` + `SameSite=Lax` + `Secure` in production, per-session CSRF token checked on every mutation, separate admin sessions with 8-hour TTL by default.
- **Rate limiting:** database-backed fixed windows so limits survive serverless cold starts.
- **Security headers:** explicit CSP, `nosniff`, referrer policy, permissions policy, HSTS in production, `frame-ancestors 'none'` unless `ALLOW_IFRAME_EMBED=1` (preview environments).

---

## 3. Quick start (local)

```bash
npm ci --include=optional --ignore-scripts   # optional dep = prebuilt SQLite driver, no native rebuild
cp .env.example .env.local          # fill in values, see below
npm run check:db                    # verifies the driver + applies migrations
npm run db:backup                   # verified SQLite backup + retention (see docs/DEPLOYMENT.md §8)
npm run db:migrate                  # creates the schema + seeds campaign tasks/settings
npm run dev                         # http://localhost:3000
```

`better-sqlite3` is an optional dependency so PostgreSQL deployments never need a native build, and it
ships a prebuilt binary. Install it with `--include=optional --ignore-scripts`: without the first flag npm
skips it, and with install scripts enabled its `node-gyp rebuild` fails on hosts that cannot reach the
Node header mirror — npm then removes the package *silently*. `npm run check:db` reports a missing driver
with the exact fix. PostgreSQL deployments only need `DATABASE_URL`.

Default local config uses SQLite at `./data/offr.db` and mock balances are **off** by default
(`CHAIN_MODE=live` needs RPC egress). For offline UI work:

```bash
CHAIN_MODE=mock npm run dev
```

> `CHAIN_MODE=mock` is refused when `NODE_ENV=production`, so a mock balance can never reach production.

Create/reset an admin account at any time:

```bash
npm run admin:hash -- --email team@offr.xyz --password 'a-long-unique-password'
# or with env vars:
ADMIN_EMAIL=team@offr.xyz ADMIN_PASSWORD='a-long-unique-password' npm run admin:hash
```

The first login attempt also bootstraps the admin from `ADMIN_EMAIL` + `ADMIN_PASSWORD` if the table is empty
(the plaintext password is hashed with scrypt and never stored).

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes | Public origin, used in metadata. |
| `SQLITE_PATH` | if no `DATABASE_URL` | SQLite file path (persistent disk). |
| `DATABASE_URL` | optional | `postgresql://…` switches the app to PostgreSQL automatically (recommended for serverless). |
| `BASE_RPC_URL` | yes (live) | Base mainnet RPC endpoint. |
| `CHAIN_MODE` | no | `live` (default) or `mock` (dev/test only). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_BOT_USERNAME` | optional | Enables automatic Telegram membership verification. |
| `TELEGRAM_WEBHOOK_SECRET` | optional | Only for webhook mode (recommended in production). |
| `X_BEARER_TOKEN` | optional | Enables X API post verification. |
| `X_ACCOUNT_HANDLE` | optional | Official handle, default `OFFR35`. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes (bootstrap) | First admin provisioning. Rotate via `npm run admin:hash`. |
| `ADMIN_SESSION_HOURS` | optional | Admin session TTL, default 8. |
| `TEAM_WALLET_ADDRESS` | recommended | If set, only transfers **from** this wallet verify payout hashes. |
| `TRUST_PROXY` | optional | `1` trusts `X-Forwarded-For` (auto-enabled on Vercel/Fly/Railway/Render), `0` forces it off. Unset elsewhere = header ignored. |
| `RATE_LIMIT_DISABLED` | no | Test-only escape hatch; force-disabled when `NODE_ENV=production`. |
| `TOKEN_DECIMALS` | optional | Skips the on-chain decimals read; only for a documented incident. |
| `ALLOW_IFRAME_EMBED` | optional | `1` allows iframe embedding (sandbox previews only). |

Never commit `.env.local`. `.env.example` documents every variable with no secrets.

---

## 4. Campaign configuration

Everything below is editable in **Admin → Settings / Tasks** without a redeploy:

- Campaign window and open/closed state.
- Reward budget, OFFR-per-point rate, minimum qualifying points, per-participant reward and point caps.
- Holding requirement: minimum balance, required verified days, minimum spacing between counted checks, and whether holding is required for *any* reward.
- Referral points, referral limit, credit-on-first-approval rule.
- Task list with per-task weights, maximum awards per wallet, proof requirements and auto-verification mode.
- Shown-to-user payout disclaimer (defaults to “approval and payout are never guaranteed”).

Points are the task weight. Approving a claim credits the ledger (`points_ledger`) immediately and rebuilds
the cached total; rejecting an approved claim reverses it. Points are not tokens, and no reward is
transferred automatically.

---

## 5. Integrations

### Telegram (automatic membership)
1. Create a bot with **@BotFather**.
2. Add the bot to the OFFR community chat **as an administrator** (required by `getChatMember`).
3. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (e.g. `-100…` or `@OFFR77`), and optionally
   `TELEGRAM_BOT_USERNAME` (otherwise resolved with `getMe`).
4. Linking flow: the participant taps **Connect Telegram** → deep link `t.me/<bot>?start=<token>` → presses
   Start → the server matches the token (polling by default, or `/api/telegram/webhook` with
   `TELEGRAM_WEBHOOK_SECRET`) → membership is checked with the Bot API → a verified claim is queued for
   approval.

Without these variables the Telegram task accepts a manual `@username` claim instead and the UI says so.

### X / Twitter
- **Post verification** (`X_BEARER_TOKEN`, app-only): the API is asked for the post's author and text; the
  author must match the participant's handle and the post must mention OFFR and post-date the campaign start.
- **Follow verification** requires user-context OAuth with the participant's own token, which this MVP does
  not implement. Follow claims are routed to manual review and labelled as such in the UI and admin queue.
- 401/403/429/network failures are surfaced as “manual review”, never as verified.

---

## 6. Testing

```bash
npm test              # 79 unit/integration tests (Vitest, 9 files)
npm run typecheck     # tsc --noEmit
npm run build         # production build
```

End-to-end smoke test against a running server (creates wallets, signs, submits, reviews, pays):

```bash
# Pass any LOCAL throwaway password; the harness defaults to a build-time fixture
# that is only ever provisioned by a mock-mode dev server. Never reuse it on a
# deployment that can reach Base mainnet. The harness refuses non-localhost hosts.
CHAIN_MODE=mock SQLITE_PATH=./data/e2e.db ADMIN_EMAIL=admin@offr.test \
ADMIN_PASSWORD='<any-local-password>' npm run dev

npx tsx scripts/e2e.ts    # 62 assertions, exits non-zero on failure
```

Coverage highlights:
- Reward maths: rate conversion, per-user cap, budget cap, point floor, holding gate, blocked wallet.
- Payout verification: reverted tx, missing transfer, wrong recipient, short transfer, summed logs, malformed/duplicate hashes.
- Holding duration: distinct days, same-day duplicates, minimum spacing, below-minimum snapshots.
- Proof canonicalisation: X link variants collapse to one id, tracking params stripped.
- Auth: scrypt hashing, wrong password, unknown account, lockout after 5 failures.
- Database: migrations, idempotent seeding, one record per wallet, referral binding, ledger recomputation, unique Telegram link, duplicate proof rejection, approval/rejection/revocation.
- Concurrency (added in the pre-merge audit): two simultaneous approvals credit points once, two simultaneous approvals credit a referral once, two simultaneous payouts cannot exceed the budget or the per-wallet cap, and a second pending claim for the same task is rejected by the engine.
- PostgreSQL path: the real migrations, the `?`→`$n` placeholder conversion, the partial unique indexes and the atomic payout gate all execute against an in-process Postgres engine (`@electric-sql/pglite`).
- E2E: wallet signature auth, CSRF enforcement, duplicate claims, cross-wallet proof reuse, admin auth, review queue, referral credit, payout caps, blocking, audit trail, rate limiting, SSR pages.

Not executable in the build sandbox (no network egress to Base RPC, `api.telegram.org` or `api.x.com`):
live on-chain reads, live Telegram/X calls, and browser-level wallet switching. Those paths were exercised
with an injected chain provider and explicit failure handling; they must be re-verified once deployed with
real credentials (see `docs/DEPLOYMENT.md` → launch checklist).

---

## 7. Deployment

**Launching the campaign? Read [docs/LAUNCH.md](./docs/LAUNCH.md) — the one-page, phone-friendly guide.**
**No budget and no credit card? Read [docs/DEPLOYMENT-FREE.md](./docs/DEPLOYMENT-FREE.md).**

The **card-free default** is a free web host (Render free instance, or Vercel Hobby) plus a free Postgres
database (Neon). [`render.yaml`](./render.yaml) is a ready Blueprint for that shape — free instance, no
disk, `DATABASE_URL` as the only required secret — and [`vercel.json`](./vercel.json) configures the
Vercel flavour. The paid, single-host variant with SQLite on a persistent disk lives in
[`render-paid.yaml`](./render-paid.yaml). Field-by-field tables, backup/restore and the free-tier limits
are in **[docs/DEPLOYMENT-FREE.md](./docs/DEPLOYMENT-FREE.md)** and
**[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)**.

Security model and threat notes: **[docs/SECURITY.md](./docs/SECURITY.md)**.

---

## 8. API surface (all JSON, same-origin, CSRF-protected mutations)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/nonce` | – | Issue a sign-in message |
| POST | `/api/auth/verify` | – | Verify signature, create session |
| GET | `/api/auth/session` | cookie | Current session + CSRF token |
| POST | `/api/auth/logout` | user | Destroy session |
| GET | `/api/me` | user | Full dashboard payload |
| POST | `/api/tasks/[slug]/submit` | user | Submit proof |
| POST | `/api/holdings/verify` | user | Server-side balance check |
| POST | `/api/referral/apply` | user | Attach a referral code |
| POST | `/api/telegram/link/start` \| `/poll` | user | Telegram linking |
| POST | `/api/telegram/webhook` | secret header | Bot updates (production) |
| GET | `/api/leaderboard`, `/api/stats`, `/api/health` | – | Public data |
| POST | `/api/admin/login` \| `/logout` | – / admin | Admin session |
| GET | `/api/admin/{overview,participants,submissions,payouts,tasks,settings,audit}` | admin | Console data |
| POST | `/api/admin/submissions/[id]/review` | admin | Approve / reject / revoke |
| PUT | `/api/admin/settings` | admin | Campaign configuration |
| POST | `/api/admin/payouts`, `/api/admin/payouts/[id]` | admin | Record / re-verify / void payouts |
| POST | `/api/admin/tasks`, `PATCH/DELETE /api/admin/tasks/[id]` | admin | Task management |
| POST | `/api/admin/users/[id]` | admin | Block / unblock / note |

---

## 9. Project layout

```
src/app/                 routes (site pages, admin console, API handlers)
src/components/          UI: wallet provider, dashboard, admin shell
src/lib/db/              portable SQL layer + migrations
src/lib/auth/            SIWE-style nonce, sessions, CSRF, admin passwords
src/lib/services/        rewards, submissions, holdings, payouts, dashboard, telegram
src/lib/integrations/    Telegram Bot API and X API clients
src/lib/chain/           Base RPC provider (live) + deterministic mock for tests
scripts/                 migrate, provision-admin, e2e
tests/                   Vitest suites
docs/                    deployment + security notes
```

---

## 10. Honest limitations

- X **follow** checks are manual (needs user-context OAuth); X **post** checks are automatic when a bearer token is present.
- Holding duration is proven by repeated server-side snapshots (at least 20 h apart by default), not by continuous indexing. Continuous-hold proofs would require an indexer.
- Payouts are recorded and verified, but tokens are transferred manually — by design, nothing auto-sends.
- PostgreSQL support is implemented but was exercised only on SQLite in this environment.
- No email/2FA on the admin account yet; use a long unique password and keep the admin URL unlisted.
