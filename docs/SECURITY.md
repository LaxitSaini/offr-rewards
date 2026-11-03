# Security notes

## Trust boundaries

- The browser is untrusted. Balances, points, eligibility and verification results are computed on the server.
- The chain is the source of truth for token balances and payout transfers. The RPC endpoint is trusted to
  answer correctly; use a reputable provider in production and keep `TEAM_WALLET_ADDRESS` set.
- The database is trusted. Session tokens are stored only as SHA-256 hashes, admin passwords only as scrypt
  hashes, and no private keys ever exist in the app.

## Authentication

| Control | Implementation |
| --- | --- |
| Wallet sign-in | Server-generated message with nonce, domain, URI, chain id, issue/expiry time; stored and re-verified byte-for-byte; single use; 10-minute TTL. |
| Signature validation | `viem` public client `verifyMessage` (EOA + ERC-1271), with a direct recovery fallback. |
| Sessions | 32-byte random token in an `httpOnly`, `SameSite=Lax`, `Secure` (prod) cookie; SHA-256 hash + expiry + revocation stored server-side; 30 days for users, 8 hours for admins. |
| CSRF | Per-session token required in `x-offr-csrf` on every mutating request, plus an `Origin`/`Host` check. |
| Admin passwords | scrypt (N=16384, r=8, p=1) with per-user salt; constant-time comparison; minimum 12 characters with letters and numbers. |
| Brute force | Per-IP and per-email rate limits on admin login, plus account lockout for 15 minutes after 5 failures, with generic error messages to prevent account enumeration. |
| Admin authorisation | Enforced inside every admin route handler; middleware additionally refuses `/api/admin/*` requests without an admin cookie. Hidden UI is never the control. |
| Admin bootstrap | Only when the `admins` table is empty, only with a password that passes the policy, and only a scrypt hash is stored. Production logs a warning while `ADMIN_PASSWORD` remains set. |

## Abuse prevention

- One participant record per wallet (unique index); wallet addresses normalised to lowercase.
- Per-task content hashes: X links collapse to the tweet id, handles are normalised, other URLs have tracking
  parameters stripped, so the same proof cannot be submitted twice — including from a different wallet.
- Only one pending claim per task per wallet — enforced by a partial unique index in the database, not just
  by an application check; awards capped by `max_awards`.
- Telegram accounts are unique across wallets.
- Referral codes: self-referral blocked, binding only within 24 hours of joining, capped per participant,
  credited only after the invitee's first approval.
- IP clustering (3+ wallets from one address) and same-IP referrer/referee pairs raise risk flags for human
  review instead of silently banning.
- Rate limits (database-backed, per wallet and per IP): nonce 30/10 min, verify 30/10 min, submissions
  12/h wallet + 40/h IP, balance checks 12/h, referral 6/h, admin mutation 300/min.
- `X-Forwarded-For` is trusted only when `TRUST_PROXY=1` or the host is a known platform that overwrites
  the header (Vercel/Fly/Railway/Render), so a client cannot forge its address to sidestep per-IP limits
  and clients are not collapsed into one shared bucket on bare metal. `RATE_LIMIT_DISABLED` is force-ignored in production.
- Blocked wallets cannot submit, apply referrals, trigger balance checks or receive payouts.

## Reward integrity

- Points only move through `points_ledger` with an audit entry; approvals are idempotent (pending → approved
  only), rejections reverse credited points.
- Award amount cannot exceed the task weight, and total participant points are capped in settings.
- Payouts are capped by remaining campaign budget and per-participant reward cap **inside the insert
  statement**, so two admins paying at the same moment cannot overspend either limit.
- Approvals, rejections and revocations are compare-and-set updates on the submission status: a second
  reviewer gets a 409 and no points move. Referral credit is claimed atomically, so it is paid once even
  when two approvals land together.
- When the campaign enables a holding requirement, payouts are refused until the hold rule is met; the
  admin override is explicit and recorded in the audit log.
- Token decimals are read from the contract. If they cannot be read, a payout with a hash is refused
  rather than verified against assumed decimals (mock mode excepted, which is refused in production).
- The RPC's chain id is asserted to be Base mainnet (8453) before any balance or receipt read, and the
  token address must have contract code; a mis-pointed RPC surfaces as an error instead of a zero balance.
- A payout is only `verified` when the Base receipt contains an OFFR `Transfer` to that wallet whose summed
  value covers the recorded amount (and matches `TEAM_WALLET_ADDRESS` when configured). Unknown hashes,
  reverted transactions, wrong recipients and short transfers are all marked `failed`.
- Nothing transfers tokens automatically. The app never holds keys, and there is **no signing or
  transfer code path anywhere in `src/`** — the chain client is read-only (`getChainId`, `getCode`,
  `readContract`, `getBlockNumber`, `getTransactionReceipt`, `verifyMessage`). A payout row can only
  become `verified` through an authenticated admin request, and the transfer itself is sent by a human
  from the team wallet.

## Web hardening

- Strict CSP (no third-party scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS in production, `frame-ancestors 'none'` unless explicitly enabled for previews.
- All input validated with Zod; SQL is parameterised everywhere (no string interpolation of user input).
- `Cache-Control: no-store` on API responses; admin pages marked `noindex`.
- Errors are logged server-side and returned to clients without stack traces or internal details.
- Integration failures (Telegram/X/RPC) surface as explicit "manual review" or a retryable error — never as a
  silent success.

## Known gaps / recommended next steps

1. **TOTP 2FA for admins** — not implemented; use a long unique password and restrict admin access by network.
2. **ERC-1271 in tests** — smart-wallet signatures are supported via viem but were verified only for EOAs here.
3. **Continuous holding proof** — requires an indexer; the current rule uses spaced server-side snapshots.
4. **X follow verification** — requires user-context OAuth; currently manual review.
5. **CSRF token storage in the client** — held in memory (not localStorage) and re-fetched from
   `/api/auth/session`; cross-tab actions may need a refresh.
6. **Postgres adapter** — the migrations, placeholder conversion, partial indexes and the atomic payout gate
   run against an in-process Postgres engine (`@electric-sql/pglite`) in `tests/postgres-compat.test.ts`, but
   no hosted Postgres, connection pooler or TLS path has been exercised here. Do one supervised deploy and
   a smoke run before the campaign opens.
7. **Token symbol is advisory** — the contract address is authoritative; a non-`OFFR` symbol only logs a
   warning (the chain id and code checks are what actually catch a wrong RPC).
8. **No WAF / bot management** — free-tier hosting offers none; the database-backed rate limits and manual
   review are the mitigation.
9. **Single-process assumptions** — SQLite must not be run with more than one writer replica.

---

## Pre-merge audit (2026-11-03)

Findings raised in the final review, all fixed in this branch and covered by tests unless stated:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Critical | Two concurrent approvals of one submission each credited points (read-then-write). | Status flip is now a compare-and-set; the losing request gets 409 and writes nothing. Test: `tests/concurrency.test.ts`. |
| 2 | Critical | Referral credit could be applied twice when two approvals raced. | Atomic `UPDATE … WHERE referral_credited = 0` claim. Test: same file. |
| 3 | Critical | Budget and per-participant payout checks were read-then-insert, so parallel payouts could overspend. | Single `INSERT … SELECT … WHERE` gate; refused inserts produce a precise 400. Test: same file. |
| 4 | High | Payout verification fell back to 18 decimals when the token metadata read failed, so a hash could "verify" a mis-scaled amount. | Verification with a hash now requires on-chain metadata (or an explicit `TOKEN_DECIMALS`); otherwise HTTP 503. |
| 5 | High | `requireHoldForReward` was configurable but never enforced on payouts. | Enforced in `recordPayout`, with an explicit audited override checkbox. |
| 6 | Medium | Telegram manual-review fallback was unreachable in the UI when bot credentials were absent. | Task cards offer the `@username` form, and the API already accepted it. |
| 7 | Medium | A rejected auto-claim (e.g. holding task) could never be resubmitted because of the content-hash unique index. | Rejected auto-claims are re-opened atomically. |
| 8 | Medium | `TRUST_PROXY` defaulted to trusting `X-Forwarded-For`, allowing IP rate-limit bypass. | Opt-in on bare metal, auto-detected on platforms that overwrite the header; `0` forces off. Test: `tests/env-hardening.test.ts`. |
| 9 | Medium | `RATE_LIMIT_DISABLED` could disable limits in production. | Force-ignored when `NODE_ENV=production`. |
| 10 | Medium | `TEAM_WALLET_ADDRESS` and `TOKEN_DECIMALS` were unvalidated; a typo silently failed every payout or mis-scaled amounts. | Validated at boot; malformed values refuse to start. |
| 11 | Medium | No database constraint prevented two pending claims per task; concurrent submits could both queue. | Partial unique index added in migration `002_pending_submission_guard`. |
| 12 | Medium | Migrations were non-atomic across serverless cold starts and could crash a second instance. | "Already exists" tolerated, version insert uses `ON CONFLICT DO NOTHING`. |
| 13 | Low | Telegram webhook secret compared with `!==`. | Constant-time compare; `/start` limited to private chats; token claim is atomic; membership updates scoped to the campaign chat. |
| 14 | Low | `/api/health` disclosed whether admin bootstrap credentials were present. | Removed. |
| 15 | Low | CSP allowed external `connect-src` origins although the browser never calls an RPC. | Narrowed to `'self'`. |
| 16 | Low | X post authorship could be accepted without binding the account when no handle was supplied. | The verified author is now written to the participant record and to the submission evidence. |
| 17 | High | `getBalance` still formatted with an assumed 18 decimals when the on-chain metadata read failed, so a degraded RPC could show (and gate a hold on) a mis-scaled balance. | Balance reads now fail closed when metadata came from the fallback and `TOKEN_DECIMALS` is unset: the user sees a retryable "could not read your balance" state instead of a wrong number. Test: `tests/security-static.test.ts`. |
