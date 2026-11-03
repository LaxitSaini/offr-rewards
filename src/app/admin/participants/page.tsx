"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert, CopyButton, StatusBadge } from "@/components/ui";
import { formatDate, shortAddress } from "@/lib/format";

interface Participant {
  id: string;
  wallet: string;
  walletShort: string;
  x_username: string | null;
  telegram_username: string | null;
  points_cached: number;
  hold_days: number;
  created_at: number;
  last_seen_at: number | null;
  blocked: number;
  status: string;
  referral_code: string;
  submissions: number;
  approved: number;
  paidOffr: string;
  riskFlags: string[];
}

export default function AdminParticipantsPage() {
  const { csrf } = useAdmin();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Participant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      const data = await apiFetch<{ participants: Participant[]; total: number }>(
        `/api/admin/participants?${params.toString()}`,
      );
      setRows(data.participants);
      setTotal(data.total);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  const act = async (id: string, action: "block" | "unblock" | "note") => {
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: "POST",
        csrf,
        body: { action, note: note[id] || undefined },
      });
      setMessage(action === "block" ? "Wallet blocked." : action === "unblock" ? "Wallet unblocked." : "Note saved.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Community</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Participants</h2>
          <p className="mt-1 text-[12px] text-white/60">{total} wallets registered.</p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            void load();
          }}
        >
          <input
            className="input w-56 py-1.5 text-[12px]"
            placeholder="Wallet, X, Telegram or code"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn-secondary btn-sm">
            Search
          </button>
        </form>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      {loading && <div className="skeleton h-40 w-full" />}

      {!loading && (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <article key={row.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-[13px] text-white/85">{shortAddress(row.wallet, 6)}</span>
                    <CopyButton value={row.wallet} label="Copy" />
                    {row.blocked ? (
                      <StatusBadge status="rejected" />
                    ) : (
                      <span className="badge-neutral">Active</span>
                    )}
                    {row.riskFlags.map((flag) => (
                      <span key={flag} className="badge-pending">
                        {flag.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/60">
                    <span>{row.points_cached} pts</span>
                    <span>{row.approved}/{row.submissions} approved</span>
                    <span>{row.paidOffr} OFFR paid</span>
                    <span>{row.hold_days} hold days</span>
                    <span>code {row.referral_code}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-white/60">
                    <span>joined {formatDate(row.created_at)}</span>
                    {row.x_username && <span>X @{row.x_username}</span>}
                    {row.telegram_username && <span>TG {row.telegram_username}</span>}
                    {row.last_seen_at && <span>seen {formatDate(row.last_seen_at)}</span>}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input w-44 py-1.5 text-[11.5px]"
                    placeholder="Internal note"
                    value={note[row.id] ?? ""}
                    onChange={(e) => setNote((prev) => ({ ...prev, [e.target.id]: e.target.value }))}
                    id={row.id}
                  />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy === row.id}
                    onClick={() => void act(row.id, "note")}
                  >
                    Save note
                  </button>
                  {row.blocked ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy === row.id}
                      onClick={() => void act(row.id, "unblock")}
                    >
                      Unblock
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={busy === row.id}
                      onClick={() => void act(row.id, "block")}
                    >
                      Block
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {rows.length === 0 && (
            <div className="card p-10 text-center text-sm text-white/60">No participants match that search.</div>
          )}
        </div>
      )}

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
