"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert, StatusBadge } from "@/components/ui";
import { formatDate, shortAddress } from "@/lib/format";
import { OFFR } from "@/lib/constants";

interface Payout {
  id: string;
  wallet: string;
  x_username: string | null;
  amount: string;
  amount_raw: string;
  tx_hash: string | null;
  status: string;
  note: string | null;
  verification_detail: string | null;
  created_at: number;
  verified_at: number | null;
}

export default function AdminPayoutsPage() {
  const { csrf } = useAdmin();
  const [rows, setRows] = useState<Payout[]>([]);
  const [budget, setBudget] = useState<{ budgetOffr: string; totalPaidOffr: string; remainingOffr: string; utilisationPct: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ wallet: "", amount: "", txHash: "", note: "" });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ payouts: Payout[]; budget: typeof budget }>(
        `/api/admin/payouts?page=${page}&status=${status}`,
      );
      setRows(data.payouts);
      setBudget(data.budget);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ payout: Payout }>("/api/admin/payouts", {
        method: "POST",
        csrf,
        body: {
          wallet: form.wallet.trim(),
          amount: form.amount.trim(),
          txHash: form.txHash.trim() || null,
          note: form.note.trim() || null,
        },
      });
      setMessage(
        res.payout.status === "verified"
          ? `Payout verified on Base. Approved submissions marked paid.`
          : res.payout.status === "failed"
            ? `Recorded but on-chain verification failed: ${res.payout.verification_detail ?? ""}`
            : "Payout recorded. Add the transaction hash once the transfer is sent.",
      );
      setForm({ wallet: "", amount: "", txHash: "", note: "" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "revalidate" | "void") => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/payouts/${id}`, {
        method: "POST",
        csrf,
        body: { action, reason: action === "void" ? "Voided from admin console" : undefined },
      });
      setMessage(action === "revalidate" ? "Re-verified against Base." : "Payout voided.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="kicker">Distribution</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-[12px] text-white/40">
          Rewards are sent manually from the team wallet. Recording a payout here never moves tokens — the
          transaction hash is verified against the Base chain before a payout is marked verified.
        </p>
      </div>

      {budget && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="stat">
            <p className="text-[10px] uppercase tracking-wider text-white/30">Budget</p>
            <p className="stat-value text-[20px]">{budget.budgetOffr}</p>
          </div>
          <div className="stat">
            <p className="text-[10px] uppercase tracking-wider text-white/30">Committed</p>
            <p className="stat-value text-[20px]">{budget.totalPaidOffr}</p>
          </div>
          <div className="stat">
            <p className="text-[10px] uppercase tracking-wider text-white/30">Remaining</p>
            <p className="stat-value text-[20px] text-lime">{budget.remainingOffr}</p>
          </div>
          <div className="stat">
            <p className="text-[10px] uppercase tracking-wider text-white/30">Utilisation</p>
            <p className="stat-value text-[20px]">{budget.utilisationPct.toFixed(1)}%</p>
          </div>
        </div>
      )}

      <section className="card card-pad">
        <h2 className="text-[14px] font-semibold">Record a payout</h2>
        <p className="mt-1 text-[11.5px] text-white/35">
          Use the participant wallet address. Leave the hash blank to record a pending transfer, then add it
          with “re-verify” once sent.
        </p>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="wallet">
              Wallet address
            </label>
            <input
              id="wallet"
              className="input mono"
              placeholder="0x…"
              value={form.wallet}
              onChange={(e) => setForm({ ...form, wallet: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="amount">
              Amount (OFFR)
            </label>
            <input
              id="amount"
              className="input"
              inputMode="decimal"
              placeholder="25000"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="txHash">
              Base transaction hash (optional)
            </label>
            <input
              id="txHash"
              className="input mono"
              placeholder="0x…"
              value={form.txHash}
              onChange={(e) => setForm({ ...form, txHash: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="payoutNote">
              Internal note
            </label>
            <input
              id="payoutNote"
              className="input"
              placeholder="Season 1 payout — batch 3"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>
              {busy ? "Working…" : "Record payout"}
            </button>
          </div>
        </form>
      </section>

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {["all", "verified", "recorded", "failed", "void"].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setStatus(option);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize ${
              status === option ? "bg-lime/15 text-lime" : "border border-white/10 text-white/50"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {loading && <div className="skeleton h-32 w-full" />}

      <div className="space-y-2.5">
        {!loading && rows.length === 0 && (
          <div className="card p-10 text-center text-sm text-white/40">No payouts recorded yet.</div>
        )}
        {rows.map((row) => (
          <article key={row.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold tabular-nums">{row.amount} OFFR</span>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mono mt-1 text-[11.5px] text-white/45">
                  {shortAddress(row.wallet, 6)} · {formatDate(row.created_at)}
                  {row.x_username ? ` · @${row.x_username}` : ""}
                </p>
                {row.verification_detail && (
                  <p className="mt-1 text-[11px] text-white/35">{row.verification_detail}</p>
                )}
                {row.note && <p className="mt-0.5 text-[11px] text-white/25">Note: {row.note}</p>}
                {row.tx_hash && (
                  <a
                    href={`${OFFR.explorer}/tx/${row.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono mt-1 block break-all text-[10.5px] text-electric-soft hover:underline"
                  >
                    {row.tx_hash}
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                {row.tx_hash && row.status !== "verified" && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void act(row.id, "revalidate")}
                  >
                    Re-verify
                  </button>
                )}
                {row.status !== "verified" && row.status !== "void" && (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => void act(row.id, "void")}
                  >
                    Void
                  </button>
                )}
              </div>
            </div>
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
        <span className="text-[11px] text-white/30">Page {page}</span>
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
