"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardPayload } from "@/lib/services/dashboard";
import { TaskCard } from "@/components/dashboard/task-card";
import {
  HoldCard,
  PayoutsCard,
  PointsCard,
  ReferralCard,
  SubmissionsCard,
} from "@/components/dashboard/summary-cards";
import { Alert, ChainPill, StatusBadge } from "@/components/ui";
import { formatDate, shortAddress } from "@/lib/format";
import { OFFR } from "@/lib/constants";

export function DashboardView({ initial, csrf }: { initial: DashboardPayload; csrf: string }) {
  const router = useRouter();
  const data = initial;
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 900);
  };

  const pendingCount = data.submissions.filter((s) => s.status === "pending").length;
  const allowedTasks = data.tasks.filter((t) => t.canSubmit || t.auto_verify !== "none").length;

  return (
    <div className="shell py-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="kicker">Campaign dashboard</p>
            <ChainPill mock={data.integrations.chainMode === "mock"} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">
            Welcome back, <span className="mono text-lime">{shortAddress(data.user.wallet, 5)}</span>
          </h1>
          <p className="mt-1 text-[13px] text-white/40">
            {data.campaign.name} · ends {formatDate(data.campaign.endsAt)} ·{" "}
            {pendingCount > 0 ? `${pendingCount} submission(s) awaiting review` : "no pending reviews"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <a
            href={`${OFFR.explorer}/address/${data.user.wallet}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary btn-sm"
          >
            Wallet
          </a>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {data.user.blocked && (
          <Alert tone="error" title="Wallet restricted">
            This wallet cannot submit new contributions. Message the team on Telegram if you believe this is a
            mistake.
          </Alert>
        )}
        {!data.campaign.live && (
          <Alert tone="warn" title={data.campaign.ended ? "Campaign closed" : "Campaign not started"}>
            {data.campaign.ended
              ? "Submissions are closed. Existing submissions are still being reviewed and paid."
              : "Submissions open when the campaign goes live."}
          </Alert>
        )}
        {data.integrations.chainMode === "mock" && (
          <Alert tone="warn" title="Test mode: mock chain">
            Balances are simulated in this environment. Real on-chain verification requires CHAIN_MODE=live
            with a Base RPC URL.
          </Alert>
        )}
        {data.user.riskFlags.length > 0 && (
          <Alert tone="warn" title="Additional review required">
            Our system flagged: {data.user.riskFlags.join(", ")}. A human reviewer will check your wallet before
            any payout.
          </Alert>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <PointsCard data={data} />
          <HoldCard data={data} csrf={csrf} />
          <ReferralCard data={data} csrf={csrf} />
          <PayoutsCard data={data} />
        </div>

        <div className="space-y-4">
          <section>
            <div className="flex items-end justify-between">
              <div>
                <p className="kicker">Tasks</p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.01em]">Campaign board</h2>
              </div>
              <span className="text-[11px] text-white/30">
                {data.tasks.filter((t) => t.status === "completed").length}/{allowedTasks} verified
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {data.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  csrf={csrf}
                  telegramConfigured={data.integrations.telegramConfigured}
                  telegramLinked={data.user.telegramLinked}
                />
              ))}
              {data.tasks.length === 0 && (
                <div className="card p-6 text-center text-sm text-white/40">
                  No tasks are active right now. Check back soon.
                </div>
              )}
            </div>
          </section>

          <SubmissionsCard data={data} />

          <section className="card p-5">
            <p className="kicker">Verification log</p>
            <h2 className="mt-1 text-[15px] font-semibold">Server-side checks</h2>
            <p className="mt-1 text-[12px] text-white/40">
              Everything below was checked by the OFFR server — never by your browser.
            </p>
            <div className="mt-3 space-y-2">
              {data.verifications.length === 0 && (
                <p className="py-4 text-center text-[12.5px] text-white/30">
                  No verifications recorded yet.
                </p>
              )}
              {data.verifications.map((v, index) => (
                <div
                  key={`${v.kind}-${v.checkedAt}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium capitalize">{v.kind.replace(/_/g, " ")}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-white/35">{v.detail ?? "—"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={v.status} />
                    <span className="text-[10px] text-white/25">{formatDate(v.checkedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
