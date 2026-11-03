import Link from "next/link";
import { ConnectButton } from "@/components/connect-button";
import { ChainPill, CopyButton } from "@/components/ui";
import { ensureBoot } from "@/lib/bootstrap";
import { OFFR } from "@/lib/constants";
import { getPublicStats, getLeaderboard } from "@/lib/services/dashboard";
import { listActiveTasks } from "@/lib/services/tasks";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  telegram: "Community",
  x_follow: "Social",
  x_post: "Content",
  meme: "Creative",
  content: "Content",
  hold: "On-chain",
  referral: "Referral",
  custom: "Task",
};

const VERIFY_LABEL: Record<string, string> = {
  telegram: "Bot API verified",
  x_post: "X API when available",
  onchain_hold: "On-chain balance",
  none: "Team reviews",
};

export default async function LandingPage() {
  await ensureBoot();
  const [stats, tasks, top] = await Promise.all([
    getPublicStats(),
    listActiveTasks(),
    getLeaderboard(5),
  ]);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-60" />
        <div className="shell relative pt-12 sm:pt-20">
          <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="animate-riseIn">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-live">
                  <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-lime" />
                  {stats.live ? "Campaign live" : stats.ended ? "Campaign closed" : "Campaign upcoming"}
                </span>
                <ChainPill mock={stats.integrations.chainMode === "mock"} />
              </div>

              <h1 className="h1 mt-5">
                Contribute to OFFR.
                <br />
                <span className="bg-gradient-to-r from-lime via-lime-soft to-electric bg-clip-text text-transparent">
                  Get recognised.
                </span>
              </h1>

              <p className="muted mt-5 max-w-xl text-[15px] sm:text-base">
                OFFR Rewards is the community campaign for {OFFR.tokenName} on Base. Complete real,
                verifiable contributions — community, research posts, memes, content and on-chain holding —
                and track your review and reward status in one dashboard.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/dashboard" className="btn-primary w-full sm:w-auto">
                  Open the campaign dashboard
                </Link>
                <a href="#tasks" className="btn-secondary w-full sm:w-auto">
                  See the tasks
                </a>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
                <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  No transaction required
                </span>
                <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  Never asks for a seed phrase
                </span>
                <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  Every payout reviewed manually
                </span>
              </div>
            </div>

            {/* Campaign card */}
            <div className="card card-pad animate-riseIn">
              <div className="flex items-start justify-between">
                <div>
                  <p className="kicker">Season 1</p>
                  <h2 className="mt-1 text-lg font-semibold">$OFFR campaign</h2>
                </div>
                <span className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                  Base
                </span>
              </div>

              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-white/40">Runs</dt>
                  <dd className="text-right text-[13px] text-white/75">
                    {formatDate(stats.startsAt)} → {formatDate(stats.endsAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/40">Reward pool cap</dt>
                  <dd className="font-semibold tabular-nums text-lime">{stats.budgetOffr} OFFR</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/40">Verified payouts</dt>
                  <dd className="tabular-nums text-white/75">
                    {stats.rewardsPaidOffr} OFFR · {stats.verifiedPayouts} tx
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/40">Task catalogue</dt>
                  <dd className="tabular-nums text-white/75">{stats.activeTasks} tasks</dd>
                </div>
              </dl>

              <div className="divider my-4" />

              <div className="rounded-xl border border-white/[0.07] bg-ink-900/70 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
                    Token contract
                  </p>
                  <CopyButton value={OFFR.tokenAddress} label="Copy" />
                </div>
                <a
                  href={`${OFFR.explorer}/token/${OFFR.tokenAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-1.5 block break-all text-[11.5px] text-white/55 hover:text-lime"
                >
                  {OFFR.tokenAddress}
                </a>
              </div>

              <div className="mt-4">
                <ConnectButton full label="Connect wallet to start" />
                <p className="mt-2 text-center text-[11px] text-white/30">
                  Sign a message to prove wallet ownership. Free, no gas.
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Participants", value: stats.participants.toLocaleString() },
              { label: "Points awarded", value: stats.pointsAwarded.toLocaleString() },
              { label: "Rewards paid", value: `${stats.rewardsPaidOffr} OFFR` },
              { label: "Active tasks", value: String(stats.activeTasks) },
            ].map((item) => (
              <div key={item.label} className="stat">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
                  {item.label}
                </p>
                <p className="stat-value">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tasks */}
      <section id="tasks" className="shell mt-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker">What counts</p>
            <h2 className="h2 mt-2">The campaign task board</h2>
            <p className="muted mt-2 max-w-2xl">
              Weights are set by the team and can be tuned during the campaign. Points are awarded only after
              a contribution is reviewed and approved.
            </p>
          </div>
          <Link href="/dashboard" className="btn-secondary btn-sm">
            Start with your wallet
          </Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="card group flex flex-col justify-between p-5 transition hover:border-white/15 hover:bg-ink-800/60"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                    {TYPE_LABEL[task.type] ?? "Task"}
                  </span>
                  <span className="whitespace-nowrap rounded-md bg-lime/10 px-2 py-1 text-[11px] font-bold text-lime">
                    +{task.points} pts
                  </span>
                </div>
                <h3 className="mt-3 text-[15px] font-semibold leading-snug">{task.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">{task.description}</p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                <span className="text-[11px] text-white/35">
                  {VERIFY_LABEL[task.auto_verify] ?? "Team reviews"}
                </span>
                <span className="text-[11px] text-white/25">
                  {task.max_awards > 1 ? `Up to ${task.max_awards}×` : "Once per wallet"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="shell mt-20">
        <p className="kicker">Process</p>
        <h2 className="h2 mt-2">Three steps, no guesswork</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Connect & sign",
              body: "Connect a Base-compatible wallet. You sign a plain message — no transaction, no gas, no seed phrase. Your OFFR balance is read from Base by our server.",
            },
            {
              step: "02",
              title: "Complete verified tasks",
              body: "Telegram membership is checked with the Telegram Bot API. X posts are checked with the official X API when credentials are available, otherwise queued for manual review.",
            },
            {
              step: "03",
              title: "Team reviews & pays",
              body: "The team reviews each submission inside the admin console, then records the payout with its Base transaction hash. Nothing is transferred automatically.",
            },
          ].map((item) => (
            <div key={item.step} className="card p-5">
              <span className="mono text-xs text-lime/70">{item.step}</span>
              <h3 className="mt-2 text-[15px] font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Leaderboard preview + disclosure */}
      <section className="shell mt-20 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="card">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div>
              <p className="kicker">Standings</p>
              <h2 className="mt-1 text-[15px] font-semibold">Top contributors</h2>
            </div>
            <Link href="/leaderboard" className="text-[12px] font-medium text-white/45 hover:text-lime">
              Full leaderboard →
            </Link>
          </div>
          <div className="px-5 py-2">
            {top.length === 0 && (
              <p className="py-8 text-center text-sm text-white/35">
                No approved contributions yet. The first approved task takes rank 1.
              </p>
            )}
            {top.map((entry) => (
              <div key={entry.rank} className="row">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`mono w-6 text-center text-[12px] ${
                      entry.rank === 1 ? "text-lime" : "text-white/35"
                    }`}
                  >
                    {String(entry.rank).padStart(2, "0")}
                  </span>
                  <span className="mono truncate text-white/70">{entry.wallet}</span>
                  {entry.xUsername && (
                    <span className="hidden text-[11px] text-white/30 sm:inline">@{entry.xUsername}</span>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums text-white/80">{entry.points}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <p className="kicker">Straight talk</p>
          <h2 className="mt-1 text-[15px] font-semibold">What this campaign is — and isn&apos;t</h2>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-white/50">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              Points reflect reviewed contributions. They are not tokens and carry no guaranteed value.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              Rewards are distributed continuously after review — there is no fixed weekly schedule and no
              guaranteed payout.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              Submissions are limited per wallet. One wallet, one person; duplicate or farmed accounts are
              rejected.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              Verify integrations:{" "}
              {stats.integrations.telegram ? "Telegram Bot API live" : "Telegram auto-check pending credentials"}
              {" · "}
              {stats.integrations.x ? "X API live" : "X checks manual (API key not set)"}
              {stats.integrations.chainMode === "mock" ? " · chain in mock mode" : " · live Base RPC"}.
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={OFFR.xUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              Follow @OFFR35
            </a>
            <a href={OFFR.telegramUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              Join Telegram
            </a>
          </div>
        </div>
      </section>

      <section className="shell mt-16">
        <div className="relative overflow-hidden rounded-2xl border border-lime/20 bg-gradient-to-br from-lime/[0.08] via-ink-850 to-ink-900 p-6 sm:p-8">
          <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="h2">Ready to contribute?</h2>
              <p className="muted mt-2 max-w-lg">
                Connect a wallet, complete the tasks you are good at, and follow your review status in the
                dashboard. Most reviews happen within a few days.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Link href="/dashboard" className="btn-primary w-full">
                Open dashboard
              </Link>
              <Link href="/leaderboard" className="btn-ghost w-full text-[13px]">
                View leaderboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
