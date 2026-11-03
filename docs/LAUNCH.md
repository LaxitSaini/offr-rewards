# OFFR Rewards — launch guide (read this one)

Everything can be done from an Android phone in a browser. You never type a secret into a chat, a ticket
or this repository — only into the hosting dashboard's encrypted environment screen.

The long version lives in [DEPLOYMENT.md](./DEPLOYMENT.md). This page is the short one.

---

## A. Deploy free, without a card (about 20 minutes, once)

You need two free accounts: **Neon** (database) and either **Render** or **Vercel** (the website).
None of them requires a credit card. Full details: [DEPLOYMENT-FREE.md](./DEPLOYMENT-FREE.md).

### Step 1 — the database (Neon, ~5 min)

1. Open **neon.tech** → sign in with Google/GitHub → **Create project**.
2. Choose the region closest to your users and remember it.
3. Press **Connect** and copy the **pooled** connection string (its address contains `-pooler`).
   That string is a password. Keep it on screen for step 2; never post it anywhere.

### Step 2 — the website

**Option A — Render (recommended for a public campaign: their terms allow commercial use).**

1. **render.com** → sign in with GitHub → **New → Blueprint** → pick this repository → **Apply**.
2. The repo's `render.yaml` is already the **free, no-disk** definition, so Render will not ask for a card.
3. Fill in the values it prompts for:
   - `DATABASE_URL` → paste the Neon pooled string from step 1
   - `NEXT_PUBLIC_APP_URL` → `https://<name>.onrender.com` (update it later if you add offr.world)
   - `ADMIN_EMAIL` → your team address · `ADMIN_PASSWORD` → a long unique password (18+ characters)
   - `BASE_RPC_URL`, Telegram, X, `TEAM_WALLET_ADDRESS` → leave blank if you do not have them; those tasks
     then go to manual review, and the UI says so
   - Leave `TOKEN_DECIMALS` **empty** (decimals are read from the contract)
4. Press **Create** and wait for **Live** (a few minutes). The free instance sleeps after 15 quiet minutes;
   the first visitor afterwards waits about a minute.

**Option B — Vercel (faster, but its free Hobby plan is for non-commercial projects only).**
Import the repo at vercel.com, add the same environment variables (`PG_POOL_MAX=1`), deploy.
`vercel.json` already has the right build and function settings.

### Step 3 — prove it is healthy

Open `https://<your-url>/api/health` and check:

- `"ok": true`
- `"database": { "ok": true, "engine": "postgres" }`
- `"chain": { "mode": "live", "metadataLive": true }`

If `metadataLive` is `false`, the Base RPC is unreachable: set `BASE_RPC_URL` to another provider's Base
mainnet URL. If `ok` is `false`, the health response now tells you why (`database.error`) without exposing
the password.

## B. First five minutes as admin

1. Open `/admin-login`, sign in with the bootstrap account.
2. **Change the password immediately** (Settings → password). Then **delete `ADMIN_PASSWORD` in Render →
   Environment** — the app logs a warning until you do, and leaving it set would let anyone who empties
   the admins table re-provision the account.
3. **Settings** → set the campaign name, `campaignStartsAt` / `campaignEndsAt`, `budgetOffr`,
   `offrPerPoint`, `minPointsForReward`, `maxRewardPerUserOffr`, `holdMinBalanceOffr`, `holdMinDays`.
   Leave `signupOpen` **off** until you are ready for the first participant.
4. Run **Prove it works** (section C). Then flip `signupOpen` on.

## C. Prove it works, in this order (10 minutes)

| # | Do this | You should see |
| --- | --- | --- |
| 1 | `/api/health` | `ok:true`, `chain.mode:"live"`, `token.source:"onchain"` |
| 2 | Open `/` on the phone | Landing page, no layout break, no horizontal scroll |
| 3 | `/admin` while logged out (private window) | Redirect to `/admin-login` — never the admin pages |
| 4 | Connect a wallet on `/`, switch network when asked | Base (8453) prompt, sign the message, dashboard opens |
| 5 | Dashboard balance | Your real OFFR balance, with a Base block number |
| 6 | Submit one task proof | "Pending review" badge, no duplicate submit button |
| 7 | `/admin/submissions` → approve it | Points credited once; a second approval is refused |
| 8 | `/leaderboard` | Your wallet appears with the same points |
| 9 | `/admin/payouts` → record a **test** transfer you actually sent | Hash verifies against the OFFR contract; a wrong hash says so |
| 10 | `/admin/audit` | Both actions above are listed with your admin email |

If any row fails, stop and do not open signup. Tell me which row and what you saw.

## D. Beta, then public

- **Closed beta (recommended first):** keep `signupOpen` on, keep the campaign budget small, invite
  5–10 people you know, watch `/admin` overview + `/admin/submissions` daily for a day or two.
- **Public:** raise the budget, announce on X [@OFFR35](https://x.com/OFFR35) and
  [t.me/OFFR77](https://t.me/OFFR77), and pin the terms line ("approval and payout are never
  guaranteed").
- **Telegram webhook** (only if you set the bot token): open
  `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://offr.world/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
  in the browser and check the response says `{"ok":true}`. The secret must equal the Render value or the
  webhook answers 401.

## E. Every day during the campaign

1. `/admin` → check the overview for failed verifications and pending items.
2. Take a backup: on Postgres use `pg_dump "$DATABASE_URL" -Fc -f offr-$(date +%F).dump` (or Neon's
   Branches → Restore window), and keep the file off the database account. `npm run db:backup` is for the
   SQLite/paid variant only and will say so.
3. Record payouts **after** you actually send the transfer, one by one, with the real hash. The app never
   moves tokens and never signs anything.

## F. If something breaks

| Symptom | Do this |
| --- | --- |
| Pages 500 right after a deploy | Check `/api/health` first: it now returns `database.error`. Typical causes: `DATABASE_URL` missing/typo'd, or the app deployed without the blueprint's build command (`npm ci --include=optional --ignore-scripts && npm run build`). |
| `/api/health` says `database.engine: "none"` | This is a serverless host with no `DATABASE_URL`. SQLite cannot persist there, so the app refuses to pretend. Add the Neon connection string. |
| The site is slow on the first visit of the day | Render's free instance sleeps after 15 minutes idle. It wakes in about a minute. Post the link on X/Telegram a few minutes before you expect visitors. |
| Database went quiet / queries pause | Neon's free tier scales to zero after ~5 minutes and has a monthly compute quota. Open the Neon dashboard to check the project state. |
| `/api/health` returns 503 | The database is unreachable — check that the disk is mounted at `/var/data` and `SQLITE_PATH` matches. |
| Everything works but balances fail | RPC is down or blocked. Set a different `BASE_RPC_URL`, or pin `TOKEN_DECIMALS` only if you know the real value. Do not guess it. |
| Suspected abuse | `/admin/participants` → block the wallet; `/admin/payouts` → void a payout. Both are audited. |
| Need to pause the campaign | Settings → `signupOpen: false` and `submissionsOpen: false`. No redeploy needed. |

Nothing in this app can move tokens. A payout only becomes `verified` after an admin pastes a real Base
transaction hash and the server reads the OFFR contract's `Transfer` log for it.
