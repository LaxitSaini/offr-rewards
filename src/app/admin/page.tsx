"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";

interface Overview {
  campaign: {
    campaignName: string;
    campaignStartsAt: number;
    campaignEndsAt: number;
    budgetOffr: string;
    offrPerPoint: string;
    submissionsOpen: boolean;
    maxRewardPerUserOffr: string;
  };
  counts: {
    participants: number;
    verifiedWallets: number;
    telegramLinked: number;
    submissions: number;
    submissionsByStatus: Record<string, number>;
    pendingPayouts: number;
    pendingPayoutOffr: string;
  };
  budget: { budgetOffr: string; totalPaidOffr: string; remainingOffr: string; utilisationPct: number };
  integrations: { telegramConfigured: boolean; xConfigured: boolean; chainLive: boolean };
  topTasks: { title: string; slug: string; points: number; approvals: number }[];
  recentAudit: {
    id: string;
    action: string;
    actor_type: string;
    actor_id: string | null;
    target_type: string | null;
    target_id: string | null;
    created_at: number;
    actor_email?: string | null;
  }[];
}

export default function AdminOverviewPage() {
  const { csrf } = useAdmin();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!csrf) return;
    apiFetch<Overview>("/api/admin/overview")
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, [csrf]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <div className="skeleton h-40 w-full" />;

  const pending = data.counts.submissionsByStatus.pending ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Operations</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{data.campaign.campaignName}</h1>
          <p className="mt-1 text-[12px] text-white/40">
            {formatDate(data.campaign.campaignStartsAt)} → {formatDate(data.campaign.campaignEndsAt)} ·{" "}
            {data.campaign.submissionsOpen ? "submissions open" : "submissions closed"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/submissions" className="btn-primary btn-sm">
            Review queue {pending > 0 && `(${pending})`}
          </Link>
          <Link href="/admin/payouts" className="btn-secondary btn-sm">
            Record payout
          </Link>
        </div>
      </div>

      {(!data.integrations.telegramConfigured || !data.integrations.xConfigured) && (
        <Alert tone="warn" title="Integrations needing credentials">
          {!data.integrations.telegramConfigured && (
            <p>
              Telegram Bot API not configured — set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and
              TELEGRAM_BOT_USERNAME. Telegram claims fall back to manual review.
            </p>
          )}
          {!data.integrations.xConfigured && (
            <p>
              X API not configured — set X_BEARER_TOKEN for automatic post verification. X claims fall back to
              manual review.
            </p>
          )}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Participants", value: data.counts.participants, sub: `${data.counts.verifiedWallets} verified wallets` },
          { label: "Pending review", value: pending, sub: `${data.counts.submissions} total submissions` },
          { label: "Telegram linked", value: data.counts.telegramLinked, sub: "Bot API linked" },
          {
            label: "Budget used",
            value: `${data.budget.utilisationPct.toFixed(1)}%`,
            sub: `${data.budget.totalPaidOffr} / ${data.budget.budgetOffr} OFFR`,
          },
        ].map((item) => (
          <div key={item.label} className="stat">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">{item.label}</p>
            <p className="stat-value">{item.value}</p>
            <p className="mt-0.5 text-[10.5px] text-white/30">{item.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="card">
          <div className="border-b border-white/[0.06] px-5 py-3.5">
            <p className="text-[12.5px] font-semibold">Task performance</p>
          </div>
          <div className="px-5 py-1">
            {data.topTasks.map((task) => (
              <div key={task.slug} className="row">
                <div className="min-w-0">
                  <p className="truncate text-[13px]">{task.title}</p>
                  <p className="text-[10.5px] text-white/30">
                    {task.points} pts · {task.slug}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-white/70">{task.approvals}</span>
              </div>
            ))}
            {data.topTasks.length === 0 && <p className="py-6 text-center text-xs text-white/30">No tasks.</p>}
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
            <p className="text-[12.5px] font-semibold">Recent activity</p>
            <Link href="/admin/audit" className="text-[11px] text-white/35 hover:text-lime">
              Full log →
            </Link>
          </div>
          <div className="px-5 py-1">
            {data.recentAudit.map((entry) => (
              <div key={entry.id} className="row">
                <div className="min-w-0">
                  <p className="mono truncate text-[12px] text-white/75">{entry.action}</p>
                  <p className="truncate text-[10.5px] text-white/30">
                    {entry.actor_type}
                    {entry.actor_email ? ` · ${entry.actor_email}` : ""}
                    {entry.target_type ? ` → ${entry.target_type}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-white/25">{formatDate(entry.created_at)}</span>
              </div>
            ))}
            {data.recentAudit.length === 0 && (
              <p className="py-6 text-center text-xs text-white/30">No activity yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Pending payouts</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{data.counts.pendingPayoutOffr} OFFR</p>
          <p className="text-[10.5px] text-white/30">{data.counts.pendingPayouts} recorded, unverified</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Reward rate</p>
          <p className="mt-1 text-lg font-semibold">{data.campaign.offrPerPoint} OFFR / point</p>
          <p className="text-[10.5px] text-white/30">Cap {data.campaign.maxRewardPerUserOffr} per wallet</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Chain verification</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <StatusBadge status={data.integrations.chainLive ? "verified" : "pending"} />
            {data.integrations.chainLive ? "Live RPC" : "Mock mode"}
          </p>
          <p className="text-[10.5px] text-white/30">Base mainnet · 8453</p>
        </div>
      </div>
    </div>
  );
}
