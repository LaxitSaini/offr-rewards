"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskView } from "@/lib/services/tasks";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert, Progress, StatusBadge } from "@/components/ui";
import { TaskGlyph } from "@/components/dashboard/task-glyph";
import { TelegramConnect } from "@/components/dashboard/telegram-connect";
import { formatDate } from "@/lib/format";

export function TaskCard({
  task,
  csrf,
  telegramConfigured,
  telegramLinked,
}: {
  task: TaskView;
  csrf: string;
  telegramConfigured: boolean;
  telegramLinked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [proofText, setProofText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<{ submission: { verificationState: string; verificationDetail: string | null } }>(
        `/api/tasks/${task.slug}/submit`,
        {
          method: "POST",
          csrf,
          body: {
            proofUrl: proofUrl.trim() ? proofUrl.trim() : null,
            proofText: proofText.trim() ? proofText.trim() : null,
          },
        },
      );
      setSuccess(
        res.submission.verificationState === "verified"
          ? "Submitted and verified. Awaiting team approval."
          : "Submitted. The team will review it shortly.",
      );
      setProofUrl("");
      setProofText("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyHoldings = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<{ hold: { balanceOffr: string; holdDays: number; meetsRequirement: boolean }; claimCreated: boolean }>(
        "/api/holdings/verify",
        { method: "POST", csrf },
      );
      setSuccess(
        res.hold.meetsRequirement
          ? `Balance verified: ${res.hold.balanceOffr} OFFR across ${res.hold.holdDays} day(s). Claim queued for approval.`
          : `Balance read on Base: ${res.hold.balanceOffr} OFFR. Holding days counted: ${res.hold.holdDays}.`,
      );
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const isTelegram = task.auto_verify === "telegram";
  const isHold = task.auto_verify === "onchain_hold";
  const showForm = task.canSubmit && open;

  const fieldHint =
    task.type === "x_follow"
      ? { text: "@your_handle", placeholder: "@handle — the account that follows @OFFR35" }
      : task.type === "x_post"
        ? { text: "X post link", placeholder: "https://x.com/yourhandle/status/…" }
        : task.type === "telegram"
          ? { text: "Telegram @username", placeholder: "@username" }
          : { text: "Proof link", placeholder: "https://…" };

  return (
    <article className="card p-4 transition hover:border-white/[0.12] sm:p-5">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-lime">
          <TaskGlyph type={task.type} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-snug">{task.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-white/45">{task.description}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="whitespace-nowrap text-sm font-bold text-lime">+{task.points}</p>
              <div className="mt-1">
                <StatusBadge status={task.status} />
              </div>
            </div>
          </div>

          {task.instructions && (
            <p className="mt-2.5 rounded-lg border border-white/[0.06] bg-ink-900/50 px-3 py-2 text-[12px] leading-relaxed text-white/40">
              {task.instructions}
            </p>
          )}

          {isHold && task.hold && (
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-ink-900/60 p-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-white/45">Verified holding days</span>
                <span className="font-semibold tabular-nums text-white/80">
                  {task.hold.holdDays} / {task.hold.requiredDays}
                </span>
              </div>
              <div className="mt-2">
                <Progress value={task.hold.progressPct} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/35">
                <span>
                  Last balance: {task.hold.balanceOffr} OFFR
                  {task.hold.qualifies ? " · above minimum" : " · below minimum"}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={verifyHoldings}
                  disabled={busy}
                >
                  {busy ? "Reading chain…" : "Verify balance"}
                </button>
              </div>
            </div>
          )}

          {task.latestSubmission && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/35">
              <span>Submitted {formatDate(task.latestSubmission.created_at)}</span>
              <span className="text-white/20">·</span>
              <StatusBadge status={task.latestSubmission.verification_state} />
              {task.latestSubmission.verification_detail && (
                <span className="w-full text-white/30">{task.latestSubmission.verification_detail}</span>
              )}
              {task.latestSubmission.review_note && (
                <span className="w-full text-white/45">Reviewer: {task.latestSubmission.review_note}</span>
              )}
            </div>
          )}

          {task.reason && (
            <p className="mt-2 text-[12px] leading-relaxed text-white/40">{task.reason}</p>
          )}

          {/* Actions */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {isTelegram && telegramConfigured && (
              <TelegramConnect csrf={csrf} configured={telegramConfigured} linked={telegramLinked} />
            )}

            {!(isTelegram && telegramConfigured) && !isHold && task.canSubmit && !open && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
                {task.status === "rejected" ? "Resubmit proof" : "Submit proof"}
              </button>
            )}

            {!(isTelegram && telegramConfigured) && !isHold && task.status === "pending" && (
              <span className="text-[12px] text-white/35">Awaiting team review</span>
            )}

            {task.status === "completed" && (
              <span className="text-[12px] text-lime/70">Completed — points credited</span>
            )}
          </div>

          {showForm && (
            <div className="mt-3 space-y-2.5 rounded-xl border border-white/[0.08] bg-ink-900/70 p-3">
              <div>
                <label className="label" htmlFor={`${task.id}-url`}>
                  {fieldHint.text}
                </label>
                <input
                  id={`${task.id}-url`}
                  className="input"
                  placeholder={fieldHint.placeholder}
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  inputMode="url"
                  autoComplete="off"
                />
              </div>

              {(task.type === "x_post" || task.type === "meme" || task.type === "content" || task.type === "custom") && (
                <div>
                  <label className="label" htmlFor={`${task.id}-text`}>
                    {task.type === "x_post" ? "Your X username (for authorship checks)" : "Short note (optional)"}
                  </label>
                  <textarea
                    id={`${task.id}-text`}
                    className="input min-h-[72px] resize-y"
                    placeholder={
                      task.type === "x_post"
                        ? "@yourhandle"
                        : "Anything the reviewer should know about this submission."
                    }
                    value={proofText}
                    onChange={(e) => setProofText(e.target.value)}
                  />
                </div>
              )}

              {task.type === "x_follow" && (
                <div>
                  <label className="label" htmlFor={`${task.id}-handle`}>
                    X username
                  </label>
                  <input
                    id={`${task.id}-handle`}
                    className="input"
                    placeholder="@handle"
                    value={proofText}
                    onChange={(e) => setProofText(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}

              {task.type === "telegram" && (
                <div>
                  <label className="label" htmlFor={`${task.id}-tg`}>
                    Telegram username
                  </label>
                  <input
                    id={`${task.id}-tg`}
                    className="input"
                    placeholder="@username"
                    value={proofText}
                    onChange={(e) => setProofText(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy}>
                  {busy ? "Submitting…" : "Submit for review"}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setOpen(false);
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-white/30">
                Your proof is stored with a hash so the exact same link cannot be submitted twice.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-2">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          {success && (
            <div className="mt-2">
              <Alert tone="success">{success}</Alert>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
