"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardPayload } from "@/lib/services/dashboard";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert, CopyButton, Progress, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { OFFR } from "@/lib/constants";

export function PointsCard({ data }: { data: DashboardPayload }) {
  const { user, reward, campaign, budget } = data;
  const capProgress = campaign.maxPointsPerUser
    ? (user.points / campaign.maxPointsPerUser) * 100
    : 0;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-white/[0.06] p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="kicker">Your standing</p>
            <div className="mt-1.5 flex items-end gap-2">
              <span className="text-[38px] font-semibold leading-none tracking-tight tabular-nums">
                {user.points.toLocaleString()}
              </span>
              <span className="mb-1 text-[12px] text-white/60">points</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/60">Rank</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-white/80">
              {user.rank ? `#${user.rank}` : "—"}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-white/60">
            <span>Points cap</span>
            <span className="tabular-nums">
              {user.points.toLocaleString()} / {campaign.maxPointsPerUser.toLocaleString()}
            </span>
          </div>
          <div className="mt-1.5">
            <Progress value={capProgress} tone="electric" />
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="rounded-xl border border-lime/20 bg-lime/[0.05] p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-lime/70">
              Estimated reward
            </p>
            <span className="text-[11px] uppercase tracking-wider text-white/60">Not final</span>
          </div>
          <p className="mt-4 text-2xl font-semibold tabular-nums text-lime">
            {reward.eligible ? `${reward.netOffr} OFFR` : "—"}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/60">
            {reward.reasons[0] ?? "Complete approved tasks to unlock a reward estimate."}
          </p>
        </div>

        <dl className="mt-4 space-y-2 text-[12px]">
          <div className="flex justify-between">
            <dt className="text-white/60">Rate</dt>
            <dd className="text-white/65">{campaign.offrPerPoint} OFFR / point</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Your cap</dt>
            <dd className="text-white/65">{campaign.maxRewardPerUserOffr} OFFR</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Minimum to qualify</dt>
            <dd className="text-white/65">{campaign.minPointsForReward} points</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Paid to you</dt>
            <dd className="tabular-nums text-white/65">{data.paidOffr} OFFR</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Campaign budget used</dt>
            <dd className="tabular-nums text-white/65">
              {budget.utilisationPct.toFixed(1)}% of {campaign.budgetOffr}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-[11.5px] leading-relaxed text-white/60">{campaign.payoutNote}</p>
      </div>
    </section>
  );
}

export function HoldCard({ data, csrf }: { data: DashboardPayload; csrf: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hold, campaign } = data;

  const verify = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ hold: { balanceOffr: string; holdDays: number }; claimCreated: boolean }>(
        "/api/holdings/verify",
        { method: "POST", csrf },
      );
      setMessage(
        `Verified on Base: ${res.hold.balanceOffr} OFFR · ${res.hold.holdDays} qualifying day(s).`,
      );
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="kicker">On-chain</p>
          <h2 className="mt-1 text-[15px] font-semibold">
            {OFFR.symbol} holding
          </h2>
        </div>
        <span
          className={`badge ${
            hold.meetsRequirement
              ? "badge-approved"
              : hold.qualifies
                ? "badge-pending"
                : "badge-neutral"
          }`}
        >
          {hold.meetsRequirement ? "Requirement met" : hold.qualifies ? "Building days" : "Below minimum"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/[0.06] bg-ink-900/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-white/60">Balance</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{hold.balanceOffr}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-ink-900/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-white/60">Hold days</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {hold.holdDays} / {hold.requiredDays}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Progress value={hold.progressPct} />
        <p className="mt-2 text-[11px] text-white/60">
          Minimum {campaign.holdMinBalanceOffr} OFFR · {hold.lastCheckedAt ? `checked ${formatDate(hold.lastCheckedAt)}` : "never checked"}
        </p>
      </div>

      <button type="button" className="btn-secondary btn-sm mt-3 w-full" onClick={verify} disabled={busy}>
        {busy ? "Reading Base…" : "Verify balance now"}
      </button>

      {message && (
        <div className="mt-2">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/60">
        Balances are read by our server from the {OFFR.tokenName} contract on Base. Holding is never inferred
        from a client-side value.
      </p>
    </section>
  );
}

export function ReferralCard({ data, csrf }: { data: DashboardPayload; csrf: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const link = `${origin || ""}/?ref=${data.user.referralCode}`;

  const apply = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/referral/apply", { method: "POST", csrf, body: { code: code.trim() } });
      setMessage("Referral linked.");
      setCode("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <p className="kicker">Referrals</p>
      <h2 className="mt-1 text-[15px] font-semibold">Bring builders in</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-white/60">
        Earn {data.campaign.referralPoints} points when a wallet you invited gets its first contribution
        approved. Limit {data.campaign.maxReferralsPerUser} per participant.
      </p>

      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/[0.07] bg-ink-900/60 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-white/60">Your code</p>
          <p className="mono mt-0.5 text-[13px] text-white/80">{data.user.referralCode}</p>
        </div>
        <div className="flex gap-1.5">
          <CopyButton value={data.user.referralCode} label="Code" />
          <CopyButton value={link} label="Link" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-2">
          <p className="text-[11px] text-white/60">Invited</p>
          <p className="text-sm font-semibold tabular-nums">{data.referrals.total}</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-2">
          <p className="text-[11px] text-white/60">Credited</p>
          <p className="text-sm font-semibold tabular-nums">{data.referrals.credited}</p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-ink-900/50 p-2">
          <p className="text-[11px] text-white/60">Points</p>
          <p className="text-sm font-semibold tabular-nums">{data.referrals.pointsEarned}</p>
        </div>
      </div>

      {!data.user.referredBy && (
        <div className="mt-3">
          <label className="label" htmlFor="referral-apply">
            Were you invited? Enter a code
          </label>
          <div className="flex gap-2">
            <input
              id="referral-apply"
              className="input flex-1 uppercase"
              placeholder="ABC123"
              value={code}
              maxLength={12}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="button" className="btn-secondary btn-sm" onClick={apply} disabled={busy || !code}>
              {busy ? "…" : "Apply"}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-white/60">
            Codes can be applied within 24 hours of joining and only once.
          </p>
        </div>
      )}

      {message && (
        <div className="mt-2">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </section>
  );
}

export function PayoutsCard({ data }: { data: DashboardPayload }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <p className="kicker">Rewards</p>
          <h2 className="mt-1 text-[15px] font-semibold">Payout status</h2>
        </div>
        <span className="text-[11px] text-white/60">
          {data.payouts.length} record{data.payouts.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="px-5 py-1">
        {data.payouts.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-white/60">
            No payouts recorded yet. Approved contributions are paid manually by the team.
          </p>
        )}
        {data.payouts.map((payout) => (
          <div key={payout.id} className="row">
            <div className="min-w-0">
              <p className="text-sm font-medium tabular-nums">{payout.amount} OFFR</p>
              <p className="mt-0.5 text-[11px] text-white/60">{formatDate(payout.created_at)}</p>
              {payout.verification_detail && (
                <p className="mt-0.5 line-clamp-2 text-[11.5px] text-white/60">{payout.verification_detail}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={payout.status} />
              {payout.tx_hash && (
                <a
                  href={`${OFFR.explorer}/tx/${payout.tx_hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[11.5px] text-electric-soft hover:underline"
                >
                  {payout.tx_hash.slice(0, 10)}…{payout.tx_hash.slice(-6)}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SubmissionsCard({ data }: { data: DashboardPayload }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <p className="kicker">History</p>
          <h2 className="mt-1 text-[15px] font-semibold">Your submissions</h2>
        </div>
        <span className="text-[11px] text-white/60">{data.submissions.length}</span>
      </div>
      <div className="px-5 py-1">
        {data.submissions.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-white/60">
            Nothing submitted yet. Pick a task above to get started.
          </p>
        )}
        {data.submissions.map((submission) => (
          <div key={submission.id} className="border-b border-white/[0.05] py-3.5 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">{submission.taskTitle}</p>
                <p className="mt-0.5 text-[11px] text-white/60">{formatDate(submission.createdAt)}</p>
                {submission.proofUrl && (
                  <a
                    href={submission.proofUrl.startsWith("http") ? submission.proofUrl : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-[11px] text-electric-soft hover:underline"
                  >
                    {submission.proofUrl}
                  </a>
                )}
                {submission.proofText && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-white/60">{submission.proofText}</p>
                )}
                {submission.reviewNote && (
                  <p className="mt-1 rounded-md border border-white/[0.06] bg-ink-900/60 px-2 py-1 text-[11px] text-white/65">
                    Reviewer: {submission.reviewNote}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <StatusBadge status={submission.status} />
                <span className="text-[11px] tabular-nums text-white/60">
                  {submission.pointsAwarded > 0 ? `+${submission.pointsAwarded}` : "—"}
                </span>
                {submission.status === "pending" && (
                  <StatusBadge status={submission.verificationState} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
