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
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-white/60 transition hover:border-lime/30 hover:text-lime ${className}`}
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
      {copied ? "Copied" : label}
    </button>
  );
}

export function Progress({ value, tone = "lime" }: { value: number; tone?: "lime" | "electric" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
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
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${styles}`} role="status">
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
      <p className="text-sm font-medium text-white/70">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-xs text-white/40">{children}</div>}
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
