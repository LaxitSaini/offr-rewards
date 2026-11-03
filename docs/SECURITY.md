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

## Abuse prevention

- One participant record per wallet (unique index); wallet addresses normalised to lowercase.
- Per-task content hashes: X links collapse to the tweet id, handles are normalised, other URLs have tracking
  parameters stripped, so the same proof cannot be submitted twice — including from a different wallet.
- Only one pending claim per task per wallet; awards capped by `max_awards`.
- Telegram accounts are unique across wallets.
- Referral codes: self-referral blocked, binding only within 24 hours of joining, capped per participant,
  credited only after the invitee's first approval.
- IP clustering (3+ wallets from one address) and same-IP referrer/referee pairs raise risk flags for human
  review instead of silently banning.
- Rate limits (database-backed, per wallet and per IP): nonce 30/10 min, verify 30/10 min, submissions
  12/h wallet + 40/h IP, balance checks 12/h, referral 6/h, admin mutation 300/min.

## Reward integrity

- Points only move through `points_ledger` with an audit entry; approvals are idempotent (pending → approved
  only), rejections reverse credited points.
- Award amount cannot exceed the task weight, and total participant points are capped in settings.
- Payouts are capped by remaining campaign budget and per-participant reward cap.
- A payout is only `verified` when the Base receipt contains an OFFR `Transfer` to that wallet whose summed
  value covers the recorded amount (and matches `TEAM_WALLET_ADDRESS` when configured). Unknown hashes,
  reverted transactions, wrong recipients and short transfers are all marked `failed`.
- Nothing transfers tokens automatically. The app never holds keys.

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
6. **Postgres adapter** — implemented and type-checked but only SQLite was exercised in this environment; run
   the test suite against a Postgres URL before switching if you choose that path.
