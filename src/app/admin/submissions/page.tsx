"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert, StatusBadge } from "@/components/ui";
import { formatDate, shortAddress } from "@/lib/format";

interface Verification {
  kind: string;
  status: string;
  method: string;
  detail: string | null;
  checked_at: number;
}

interface Submission {
  id: string;
  wallet: string;
  x_username: string | null;
  telegram_username: string | null;
  task_title: string;
  task_slug: string;
  task_type: string;
  task_points: number;
  status: string;
  proof_url: string | null;
  proof_text: string | null;
  verification_state: string;
  verification_detail: string | null;
  points_awarded: number;
  created_at: number;
  reviewed_at: number | null;
  review_note: string | null;
  user_submission_count: number;
  verifications: Verification[];
}

const FILTERS = ["pending", "approved", "rejected", "paid", "all"] as const;

export default function AdminSubmissionsPage() {
  const { csrf } = useAdmin();
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("pending");
  const [task, setTask] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Submission[]>([]);
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [points, setPoints] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ status, page: String(page) });
      if (task) query.set("task", task);
      const data = await apiFetch<{ submissions: Submission[]; tasks: { id: string; title: string }[] }>(
        `/api/admin/submissions?${query.toString()}`,
      );
      setRows(data.submissions);
      setTasks(data.tasks);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status, page, task]);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  const review = async (id: string, action: "approve" | "reject" | "revoke") => {
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      const parsedPoints = points[id] ? Number(points[id]) : undefined;
      const res = await apiFetch<{ pointsAwarded: number; referralCredited: boolean }>(
        `/api/admin/submissions/${id}/review`,
        {
          method: "POST",
          csrf,
          body: {
            action,
            points: action === "approve" && Number.isFinite(parsedPoints) ? parsedPoints : undefined,
            note: note[id] || undefined,
          },
        },
      );
      setMessage(
        action === "approve"
          ? `Approved · +${res.pointsAwarded} points${res.referralCredited ? " · referral credited" : ""}`
          : action === "reject"
            ? "Submission rejected."
            : "Approval revoked and points removed.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const filters = useMemo(() => FILTERS, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Review queue</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Submissions</h2>
          <p className="mt-1 text-[12px] text-white/60">
            Server-side verification results are attached to each claim. Approving credits points immediately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto py-1.5 text-[12px]"
            value={task}
            onChange={(e) => {
              setPage(1);
              setTask(e.target.value);
            }}
          >
            <option value="">All tasks</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>
            Reload
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => {
              setStatus(filter);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition ${
              status === filter
                ? "bg-lime/15 text-lime"
                : "border border-white/10 text-white/70 hover:bg-white/[0.05]"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      {loading && <div className="skeleton h-32 w-full" />}

      {!loading && rows.length === 0 && (
        <div className="card p-10 text-center text-sm text-white/60">
          Nothing in this queue. {status === "pending" && "You are all caught up."}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-semibold">{row.task_title}</h3>
                  <StatusBadge status={row.status} />
                  <StatusBadge status={row.verification_state} />
                </div>
                <p className="mono mt-1 text-[11.5px] text-white/65">
                  {shortAddress(row.wallet, 6)} · {formatDate(row.created_at)} ·{" "}
                  {row.user_submission_count} submission(s)
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/60">
                  {row.x_username && <span>X: @{row.x_username}</span>}
                  {row.telegram_username && <span>TG: {row.telegram_username}</span>}
                  <span>Task weight: {row.task_points} pts</span>
                  {row.points_awarded > 0 && (
                    <span className="text-lime">Awarded: +{row.points_awarded}</span>
                  )}
                </div>
              </div>

              {row.status === "pending" && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input w-20 py-1.5 text-[12px]"
                    placeholder={String(row.task_points)}
                    inputMode="numeric"
                    value={points[row.id] ?? ""}
                    onChange={(e) => setPoints((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, "approve")}
                  >
                    {busy === row.id ? "…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              )}
              {row.status === "approved" && (
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  disabled={busy === row.id}
                  onClick={() => void review(row.id, "revoke")}
                >
                  Revoke approval
                </button>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-white/[0.06] bg-ink-900/60 p-3">
              {row.proof_url && (
                <a
                  href={row.proof_url.startsWith("http") ? row.proof_url : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-[12px] text-electric-soft hover:underline"
                >
                  {row.proof_url}
                </a>
              )}
              {row.proof_text && (
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-white/55">
                  {row.proof_text}
                </p>
              )}
              {row.verification_detail && (
                <p className="mt-2 text-[11px] text-white/60">System: {row.verification_detail}</p>
              )}
              {row.review_note && (
                <p className="mt-1 text-[11px] text-white/60">Previous note: {row.review_note}</p>
              )}
            </div>

            {row.verifications.length > 0 && (
              <div className="mt-2 space-y-1">
                {row.verifications.map((v, index) => (
                  <div
                    key={`${v.kind}-${index}`}
                    className="flex items-start justify-between gap-2 rounded-md border border-white/[0.05] px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] capitalize text-white/55">
                        {v.kind.replace(/_/g, " ")} · {v.method}
                      </p>
                      {v.detail && <p className="line-clamp-2 text-[11.5px] text-white/60">{v.detail}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusBadge status={v.status} />
                      <p className="mt-0.5 text-[9.5px] text-white/60">{formatDate(v.checked_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {row.status === "pending" && (
              <div className="mt-2">
                <input
                  className="input py-1.5 text-[12px]"
                  placeholder="Reviewer note (visible to the participant)"
                  value={note[row.id] ?? ""}
                  onChange={(e) => setNote((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span className="text-[11px] text-white/60">Page {page}</span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={rows.length < 25}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
