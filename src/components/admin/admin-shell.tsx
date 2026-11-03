"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminGate, useAdmin } from "@/components/admin/admin-provider";

const tabs = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/submissions", label: "Review queue" },
  { href: "/admin/participants", label: "Participants" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/tasks", label: "Tasks" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { admin, logout } = useAdmin();

  return (
    <div className="min-h-dvh">
      <header className="glass-nav sticky top-0 z-30">
        <div className="shell flex h-14 items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime text-[11px] font-black text-ink-950">
              O
            </span>
            <span className="text-sm font-semibold tracking-tight">OFFR Rewards</span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[11px] text-white/35 sm:block">{admin?.email}</span>
            <Link href="/" className="text-[11px] text-white/40 hover:text-lime">
              View site
            </Link>
            <button type="button" className="btn-secondary btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
        <div className="shell flex gap-1 overflow-x-auto pb-2">
          {tabs.map((tab) => {
            const active = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                  active
                    ? "bg-lime/10 text-lime"
                    : "text-white/45 hover:bg-white/[0.05] hover:text-white/80"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </header>
      <main className="shell py-6">
        <AdminGate>{children}</AdminGate>
      </main>
    </div>
  );
}
