import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { getDashboard } from "@/lib/services/dashboard";
import { recomputePoints } from "@/lib/users";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { ConnectButton } from "@/components/connect-button";
import { ChainPill } from "@/components/ui";
import { OFFR } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Track your OFFR contributions, points and reward status.",
};

export default async function DashboardPage() {
  await ensureBoot();
  const ctx = await getCurrentUser();

  if (!ctx) {
    return (
      <div className="shell py-14 sm:py-20">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center gap-2">
            <p className="kicker">Campaign dashboard</p>
            <ChainPill />
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Connect your wallet to open your dashboard
          </h1>
          <p className="muted mt-3">
            We&apos;ll ask your wallet to sign a plain message so we know the wallet is yours. No transaction,
            no gas, and we never ask for a seed phrase or private key.
          </p>

          <div className="card card-pad mt-6">
            <ConnectButton full />
            <ul className="mt-4 space-y-2.5 text-[12.5px] leading-relaxed text-white/45">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                Base-compatible wallets: MetaMask, Coinbase Wallet, Rabby, Brave.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                Your OFFR balance is read from{" "}
                <a
                  className="link"
                  href={`${OFFR.explorer}/token/${OFFR.tokenAddress}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  the verified contract
                </a>{" "}
                on Base.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                One wallet per person. Duplicate or farmed accounts are rejected.
              </li>
            </ul>
          </div>

          <p className="mt-4 text-center text-[12px] text-white/30">
            New here?{" "}
            <Link className="link" href="/">
              Read about the campaign
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const fresh = { ...ctx.user, points_cached: await recomputePoints(ctx.user.id) };
  const data = await getDashboard(fresh);

  return <DashboardView initial={data} csrf={ctx.session.csrf} />;
}
