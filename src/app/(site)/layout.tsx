import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { OFFR } from "@/lib/constants";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1 pb-16">{children}</main>
      <footer className="border-t border-white/[0.06] bg-ink-950/60">
        <div className="shell flex flex-col gap-6 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-lime text-[10px] font-black text-ink-950">
                O
              </span>
              <span className="text-sm font-semibold">OFFR Rewards</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/40">
              A community campaign for {OFFR.tokenName} on Base. Points are recognition for reviewed
              contributions — they are not a promise of tokens, profit or return. Every payout is reviewed
              and approved manually by the team.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-xs sm:gap-14">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Campaign</p>
              <Link className="block text-white/55 hover:text-lime" href="/dashboard">
                Dashboard
              </Link>
              <Link className="block text-white/55 hover:text-lime" href="/leaderboard">
                Leaderboard
              </Link>
              <Link className="block text-white/55 hover:text-lime" href="/admin-login">
                Team login
              </Link>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Official</p>
              <a className="block text-white/55 hover:text-lime" href={OFFR.xUrl} target="_blank" rel="noreferrer">
                @OFFR35 on X
              </a>
              <a
                className="block text-white/55 hover:text-lime"
                href={OFFR.telegramUrl}
                target="_blank"
                rel="noreferrer"
              >
                Telegram community
              </a>
              <a
                className="block break-all text-white/55 hover:text-lime"
                href={`${OFFR.explorer}/token/${OFFR.tokenAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                Contract on BaseScan
              </a>
            </div>
          </div>
        </div>
        <div className="shell flex flex-col gap-2 border-t border-white/[0.05] py-4 text-[11px] text-white/25 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} OFFR Rewards · Independent community campaign</span>
          <span className="mono break-all">{OFFR.tokenAddress}</span>
        </div>
      </footer>
    </div>
  );
}
