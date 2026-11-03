import type { Metadata } from "next";
import Link from "next/link";
import { ensureBoot } from "@/lib/bootstrap";
import { getLeaderboard, getPublicStats } from "@/lib/services/dashboard";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Approved contribution standings for the OFFR campaign.",
};

export default async function LeaderboardPage() {
  await ensureBoot();
  const [entries, stats] = await Promise.all([getLeaderboard(100), getPublicStats()]);

  return (
    <div className="shell py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Standings</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Leaderboard</h1>
          <p className="muted mt-2 max-w-xl">
            Ranked by approved contribution points — points are only credited after the team reviews a
            submission. Wallets are shortened for privacy.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="stat min-w-[110px]">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Participants</p>
            <p className="stat-value">{stats.participants}</p>
          </div>
          <div className="stat min-w-[110px]">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Points</p>
            <p className="stat-value">{stats.pointsAwarded.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="card mt-6 overflow-hidden">
        <div className="hidden grid-cols-[60px_1fr_140px_90px] gap-3 border-b border-white/[0.06] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60 sm:grid">
          <span>Rank</span>
          <span>Wallet</span>
          <span>X account</span>
          <span className="text-right">Points</span>
        </div>

        {entries.length === 0 && (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-white/70">No approved contributions yet.</p>
            <p className="mt-1 text-xs text-white/60">
              The first approved task takes rank 1 — the board updates immediately.
            </p>
            <Link href="/dashboard" className="btn-primary btn-sm mt-4">
              Start contributing
            </Link>
          </div>
        )}

        {entries.map((entry) => (
          <div
            key={entry.rank}
            className={`grid grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-white/[0.04] px-4 py-3.5 last:border-0 sm:grid-cols-[60px_1fr_140px_90px] sm:px-5 ${
              entry.rank <= 3 ? "bg-white/[0.015]" : ""
            }`}
          >
            <span
              className={`mono text-[13px] ${
                entry.rank === 1
                  ? "text-lime"
                  : entry.rank === 2
                    ? "text-white/70"
                    : entry.rank === 3
                      ? "text-ember"
                      : "text-white/60"
              }`}
            >
              {String(entry.rank).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className="mono truncate text-[13px] text-white/80">{entry.wallet}</p>
              <p className="mt-0.5 text-[11.5px] text-white/60 sm:hidden">
                {entry.approvedTasks} approved task{entry.approvedTasks === 1 ? "" : "s"}
              </p>
            </div>
            <span className="hidden truncate text-[11.5px] text-white/60 sm:block">
              {entry.xUsername ? `@${entry.xUsername}` : "—"}
            </span>
            <span className="text-right text-sm font-semibold tabular-nums text-white/85">
              {entry.points.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-[11px] text-white/60">
        Campaign window: {formatDate(stats.startsAt)} → {formatDate(stats.endsAt)} · payouts are manual and
        never guaranteed.
      </p>
    </div>
  );
}
