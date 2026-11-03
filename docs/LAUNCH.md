# OFFR Rewards — launch guide (read this one)

Everything can be done from an Android phone in a browser. You never type a secret into a chat, a ticket
or this repository — only into the hosting dashboard's encrypted environment screen.

The long version lives in [DEPLOYMENT.md](./DEPLOYMENT.md). This page is the short one.

---

## A. Deploy (about 10 minutes, once)

1. **github.com → your repository → `render.yaml`** — this file already contains the whole service
   definition (build command, start command, 1 GB disk at `/var/data`, `SQLITE_PATH=/var/data/offr.db`,
   health check `/api/health`). You do not need to invent any of it.
2. **render.com → sign in with GitHub → New → Blueprint → pick this repository → Apply.**
3. Render asks for the values marked secret. Paste them **in the Render screen**, not here:
   - `NEXT_PUBLIC_APP_URL` → `https://offr.world` (or the Render URL it gives you, until DNS is pointed)
   - `ADMIN_EMAIL` → your team address · `ADMIN_PASSWORD` → a long unique password (18+ characters)
   - `BASE_RPC_URL` → optional; leave blank to use the public Base endpoint
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `X_BEARER_TOKEN`, `TEAM_WALLET_ADDRESS` → only if you have
     them. Blank is supported: those tasks fall back to manual review and the UI says so.
   - Leave `TOKEN_DECIMALS` **empty** (decimals are read from the contract) and `CHAIN_MODE=live`.
4. Wait for the deploy to say **Live**. Open `https://<your-url>/api/health`. It must show
   `"ok":true`, `"database":{"engine":"sqlite"}`, `"chain":{"mode":"live"}`.
   `"metadataLive":false` means the RPC is unreachable — fix that before inviting anyone.
5. **Set a custom domain** (Render → Settings → Custom Domain → `offr.world`) and put the CNAME/DNS record
   Render shows you into your domain provider. Then update `NEXT_PUBLIC_APP_URL` to `https://offr.world`
   and redeploy. Cookies are `Secure`-only in production, so do not run the campaign on plain `http://`.

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
2. Take a backup: Render Shell → `npm run db:backup` (it verifies the copy and keeps the last 14), then
   download one copy off the host so a lost volume is not a lost campaign.
3. Record payouts **after** you actually send the transfer, one by one, with the real hash. The app never
   moves tokens and never signs anything.

## F. If something breaks

| Symptom | Do this |
| --- | --- |
| Pages 500 right after a deploy | The database driver is missing. Use the blueprint's build command exactly: `npm ci --include=optional --ignore-scripts && node -e "require('better-sqlite3')" && npm run build`. A plain `npm ci` silently drops the optional driver, and so does `--include=optional` *without* `--ignore-scripts` when the native rebuild fails. |
| `/api/health` returns 503 | The database is unreachable — check that the disk is mounted at `/var/data` and `SQLITE_PATH` matches. |
| Everything works but balances fail | RPC is down or blocked. Set a different `BASE_RPC_URL`, or pin `TOKEN_DECIMALS` only if you know the real value. Do not guess it. |
| Suspected abuse | `/admin/participants` → block the wallet; `/admin/payouts` → void a payout. Both are audited. |
| Need to pause the campaign | Settings → `signupOpen: false` and `submissionsOpen: false`. No redeploy needed. |

Nothing in this app can move tokens. A payout only becomes `verified` after an admin pastes a real Base
transaction hash and the server reads the OFFR contract's `Transfer` log for it.
