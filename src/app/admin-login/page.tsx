"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert } from "@/components/ui";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/admin/login", { method: "POST", body: { email, password } });
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-[13px] font-black text-ink-950">
            O
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">OFFR Rewards</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/35">Team console</p>
          </div>
        </div>

        <div className="card card-pad mt-6">
          <h1 className="text-lg font-semibold">Admin sign in</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-white/40">
            Restricted access. Sessions expire automatically and every action is written to the audit log.
          </p>

          <form className="mt-5 space-y-3" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-white/25">
          <Link href="/" className="hover:text-white/50">
            ← Back to campaign
          </Link>
        </p>
      </div>
    </div>
  );
}
