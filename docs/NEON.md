# Running OFFR Rewards on Neon

Status: **wiring done and verified against a real Postgres engine; the Neon project
itself still has to be deployed from a machine that can reach the Neon API.**
`neon deploy` could not run in the environment this was prepared in (outbound access
to `console.neon.tech` / `api.neon.tech` is blocked there), so no connection string
has been pulled and nothing was written to `.env.local` yet. Everything below is the
sequence to finish it — two commands, run where the Neon API is reachable.

## 1. Finish the Neon side (needs your browser sign-in)

```bash
cd offr-rewards
neon login            # opens a browser; complete sign-in there
neon deploy           # provisions per neon.ts, writes .env.local
```

`neon deploy` writes, for the project `noisy-dust-30837924` / org
`org-red-wave-71490138` / branch `production`:

| Variable                | Kind   | Used by |
| ----------------------- | ------ | ------- |
| `DATABASE_URL`          | pooled | the app (all queries) |
| `DATABASE_URL_UNPOOLED` | direct | schema migrations only |

`.neon/` (project link) is git-ignored. If `neon deploy` reports that the project is
already linked but no database exists, create one in the Neon console for that
project, then re-run `neon deploy`.

## 2. What the app does with those variables

- `src/lib/env.ts` — reads `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
  (direct). `parseMigrationUrl()` returns the direct URL only when it differs from
  the pooled one; otherwise `null`.
- `src/lib/db/index.ts` — the `postgres` (postgres.js) driver is kept, since that is
  what the project already used:
  - `prepare: false` and a small pool (`PG_POOL_MAX`, default `1` on serverless
    hosts, `5` elsewhere) so PgBouncer in transaction mode stays happy and a free
    tier's connection cap is not exhausted by cold starts;
  - migrations run over the **direct** endpoint when one is configured, then that
    connection is closed — DDL through a transaction-mode pooler is what Neon's own
    guidance warns about (`neon-postgres` skill).
- No driver swap, no schema rewrite: the adapter interface is unchanged, so reward
  accounting, the payout guard and the ledger keep their semantics.

## 3. Remaining environment variables

Copy the rest from `.env.example`. The minimum for a live deployment:

```
NEXT_PUBLIC_APP_URL=https://your-app.example     # https in production
DATABASE_URL / DATABASE_URL_UNPOOLED             # from `neon deploy`
PG_POOL_MAX=1                                    # serverless host
CHAIN_MODE=live
BASE_RPC_URL=https://mainnet.base.org            # or a paid RPC for throughput
ADMIN_EMAIL=...
ADMIN_PASSWORD=...                               # rotate, then unset
ADMIN_SESSION_HOURS=8
```

`CHAIN_MODE=mock` is refused when `NODE_ENV=production`; `TOKEN_DECIMALS` should be
left empty so decimals are read on-chain.

## 4. Verification that was actually run

| Check | Result |
| ----- | ------ |
| `npm run build` | passes (26/26 static pages, middleware 34.3 kB) |
| `npx vitest run` | 12 files, 118 tests pass — includes the Postgres service suite |
| App served over HTTP on a Postgres engine | 26/26 checks pass (see below) |
| `neon deploy` / `neon login` | **not run** — Neon API unreachable from the build environment |

The HTTP proof ran the production build against a real Postgres engine (PGlite,
in-process — same SQL dialect and semantics, different transport) with a scripted
client: health reports `database.engine = "postgres"`, server-rendered pages render,
anonymous `/admin*` redirects (307) come from a session lookup, admin login writes a
session that authenticates subsequent API calls, CSRF-less writes are rejected with
403, the nonce endpoint rate-limits with 429 once its window is exhausted (state in
Postgres), and the audit log contains the login written moments earlier.

The check is checked in as `scripts/postgres-http-proof.mjs`
(`BASE_URL=http://localhost:3000 npm run db:proof` — run it against a freshly
started server, since it deliberately drains the nonce rate-limit window).

To reproduce the harness locally (never in a deployment):

```bash
npm run build
DATABASE_URL="postgres://pglite@localhost:5432/offr" CHAIN_MODE=live PGLITE_TEST=1 \
  NODE_OPTIONS="--require $PWD/scripts/pglite-preload.cjs" npm start
```

The preload is not application code, is never imported by the app, and refuses to
activate on a production build unless `PGLITE_TEST=1` is set explicitly.

## 5. Free-tier notes

Neon's free plan needs no card: ~0.5 GB storage and 100 CU-hours/month, autoscaling,
built-in PgBouncer pooling, and scale-to-zero after ~5 minutes idle (roughly a
second to resume — the first request after idle is slower, which is worth knowing for
the admin payout flow). Verify current limits and the project count in the dashboard
before relying on them.
