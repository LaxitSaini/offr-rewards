"use client";

import { useState } from "react";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "badge-pending", label: "Pending" },
    approved: { cls: "badge-approved", label: "Approved" },
    rejected: { cls: "badge-rejected", label: "Rejected" },
    paid: { cls: "badge-paid", label: "Paid" },
    verified: { cls: "badge-approved", label: "Verified" },
    failed: { cls: "badge-rejected", label: "Failed" },
    manual: { cls: "badge-pending", label: "Manual review" },
    unverified: { cls: "badge-neutral", label: "Unverified" },
    completed: { cls: "badge-approved", label: "Completed" },
    in_progress: { cls: "badge-pending", label: "In progress" },
    available: { cls: "badge-neutral", label: "Available" },
    locked: { cls: "badge-rejected", label: "Locked" },
    recorded: { cls: "badge-pending", label: "Recorded" },
    void: { cls: "badge-neutral", label: "Void" },
  };
  const item = map[status] ?? { cls: "badge-neutral", label: status };
  return <span className={item.cls}>{item.label}</span>;
}

export function CopyButton({
  value,
  label = "Copy",
  what = "value",
  className = "",
}: {
  value: string;
  label?: string;
  /** Describes what is being copied, for screen readers. */
  what?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${what}`}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-white/60 transition hover:border-lime/30 hover:text-lime sm:min-h-0 ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

export function Progress({
  value,
  tone = "lime",
  label,
}: {
  value: number;
  tone?: "lime" | "electric";
  /** Accessible name, e.g. "Holding progress". */
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label ?? "Progress"}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          tone === "lime" ? "bg-lime" : "bg-electric"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "error" | "warn";
  title?: string;
  children?: React.ReactNode;
}) {
  const styles = {
    info: "border-white/10 bg-white/[0.03] text-white/70",
    success: "border-lime/25 bg-lime/[0.07] text-lime",
    error: "border-danger/25 bg-danger/[0.07] text-danger",
    warn: "border-amber-300/25 bg-amber-300/[0.06] text-amber-200",
  }[tone];
  const isUrgent = tone === "error";
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${styles}`}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
    >
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
      <p className="text-sm font-medium text-white/70">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-xs text-white/60">{children}</div>}
    </div>
  );
}

export function ChainPill({ mock }: { mock?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/60">
      <span className="h-1.5 w-1.5 rounded-full bg-electric" />
      Base · 8453
      {mock && <span className="text-amber-300">· mock chain</span>}
    </span>
  );
}

/**
 * Wallet addresses and transaction hashes are long unbreakable strings — on a
 * 320px screen they must wrap instead of forcing the page wider.
 */
export function HashText({
  value,
  kind = "hash",
  href,
  className = "",
}: {
  value: string;
  kind?: "address" | "hash";
  href?: string;
  className?: string;
}) {
  const text = (
    <span className="hash text-white/70" title={value}>
      {value}
    </span>
  );
  return (
    <span className={`inline-flex max-w-full items-start gap-1.5 ${className}`}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 underline decoration-white/20 underline-offset-2 hover:text-lime"
        >
          {text}
        </a>
      ) : (
        <span className="min-w-0">{text}</span>
      )}
      <CopyButton value={value} what={kind === "address" ? "address" : "transaction hash"} label="Copy" />
    </span>
  );
}
