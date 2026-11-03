"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";

const links = [
  { href: "/", label: "Campaign" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="glass-nav sticky top-0 z-30">
      <div className="shell flex h-16 items-center justify-between gap-4">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-[13px] font-black tracking-tighter text-ink-950">
            O
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-ink-950 bg-electric" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-[-0.02em]">OFFR</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
              Rewards
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                  active ? "bg-white/[0.06] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="https://t.me/OFFR77"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg border border-white/10 px-3 py-2 text-[13px] font-medium text-white/60 transition hover:border-white/20 hover:text-white sm:block"
          >
            Telegram
          </a>
          <ConnectButton size="sm" label="Connect" />
        </div>
      </div>

      <nav aria-label="Mobile" className="flex items-center gap-1 overflow-x-auto border-t border-white/[0.05] px-4 py-1 md:hidden">
        {links.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition ${
                active ? "bg-white/[0.07] text-white" : "text-white/70"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        <a
          href="https://x.com/OFFR35"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border border-white/10 px-3 text-[12.5px] text-white/60"
        >
          @OFFR35
        </a>
      </nav>
    </header>
  );
}
