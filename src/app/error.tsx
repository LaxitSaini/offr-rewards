"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary. Nothing internal is shown to the participant —
 * the digest is displayed so support can correlate it with the server log.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] route error:", error.message, error.digest ?? "");
  }, [error]);

  return (
    <main id="main" className="shell flex min-h-[70dvh] flex-col items-center justify-center py-16 text-center">
      <p className="kicker">Something went wrong</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
        This page could not load
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
        Your wallet and rewards are unaffected — this is a display error. Try again, and if it keeps
        happening let the team know on Telegram with the reference below.
      </p>
      {error.digest && (
        <p className="mono mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-white/65">
          ref {error.digest}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className="btn-secondary">
          Go to dashboard
        </Link>
        <a
          href="https://t.me/OFFR77"
          target="_blank"
          rel="noreferrer"
          className="btn-ghost"
        >
          Contact the team
        </a>
      </div>
    </main>
  );
}
