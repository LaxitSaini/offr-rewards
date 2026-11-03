"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert } from "@/components/ui";
import { formatDate } from "@/lib/format";

interface AuditEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: string | null;
  ip: string | null;
  created_at: number;
  actor_email: string | null;
  actor_wallet: string | null;
}

export default function AdminAuditPage() {
  const { csrf } = useAdmin();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ entries: AuditEntry[]; total: number }>(
        `/api/admin/audit?page=${page}`,
      );
      setEntries(data.entries);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  return (
    <div className="space-y-4">
      <div>
        <p className="kicker">Accountability</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Audit log</h2>
        <p className="mt-1 text-[12px] text-white/60">
          Append-only record of admin and system actions. {total} entries.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && <div className="skeleton h-40 w-full" />}

      <div className="card divide-y divide-white/[0.05] overflow-hidden">
        {entries.map((entry) => (
          <div key={entry.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="mono text-[12.5px] text-white/80">{entry.action}</p>
                <p className="mt-0.5 text-[11.5px] text-white/60">
                  {entry.actor_type}
                  {entry.actor_email ? ` · ${entry.actor_email}` : ""}
                  {entry.actor_wallet ? ` · ${entry.actor_wallet.slice(0, 10)}…` : ""}
                  {entry.target_type ? ` → ${entry.target_type}` : ""}
                  {entry.target_id ? ` (${entry.target_id.slice(0, 12)}…)` : ""}
                  {entry.ip ? ` · ${entry.ip}` : ""}
                </p>
                {entry.meta && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11.5px] text-white/60 hover:text-white/70">
                      metadata
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-white/[0.06] bg-ink-900 p-2 text-[11px] text-white/60">
                      {entry.meta}
                    </pre>
                  </details>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-white/60">{formatDate(entry.created_at)}</span>
            </div>
          </div>
        ))}
        {!loading && entries.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-white/60">No audit entries yet.</p>
        )}
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
          disabled={entries.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
