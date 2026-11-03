import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="shell flex min-h-[70dvh] flex-col items-center justify-center py-16 text-center">
      <p className="kicker">404</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">This page does not exist</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
        The link may be out of date, or the campaign page may have moved. Everything you have earned is
        still on your dashboard.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href="/dashboard" className="btn-primary">
          Open dashboard
        </Link>
        <Link href="/" className="btn-secondary">
          Back to campaign
        </Link>
        <Link href="/leaderboard" className="btn-ghost">
          Leaderboard
        </Link>
      </div>
    </main>
  );
}
