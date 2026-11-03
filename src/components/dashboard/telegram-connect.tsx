"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert } from "@/components/ui";

type PollResponse = {
  linked: boolean;
  pending: boolean;
  check?: { member: boolean; detail: string; claimCreated: boolean };
  error?: string;
};

export function TelegramConnect({
  csrf,
  configured,
  linked,
}: {
  csrf: string;
  configured: boolean;
  linked: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "verifying" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const stopPolling = () => {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  const poll = async () => {
    try {
      const res = await apiFetch<PollResponse>("/api/telegram/link/poll", {
        method: "POST",
        csrf,
      });
      if (res.linked && res.check) {
        stopPolling();
        setState("done");
        setMessage(res.check.detail);
        router.refresh();
      } else if (res.error) {
        setError(res.error);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ url: string }>("/api/telegram/link/start", {
        method: "POST",
        csrf,
      });
      setUrl(res.url);
      setState("waiting");
      setMessage("Press Start in the OFFR bot. This page will confirm automatically.");
      window.open(res.url, "_blank", "noopener,noreferrer");
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        void poll();
      }, 4000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      await poll();
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <Alert tone="info">
        Automatic Telegram checks are not enabled on this deployment. Submit your Telegram @username below and
        the team will verify your membership manually.
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {!linked && state !== "waiting" && (
        <button type="button" className="btn-primary btn-sm" onClick={start} disabled={busy}>
          {busy ? "Opening…" : "Connect Telegram"}
        </button>
      )}

      {state === "waiting" && url && (
        <div className="rounded-xl border border-white/10 bg-ink-900/80 p-3">
          <p className="text-[13px] text-white/70">{message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              Open OFFR bot
            </a>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void poll()}>
              Check again
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                stopPolling();
                setState("idle");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {linked && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-approved">Linked</span>
          <button type="button" className="btn-secondary btn-sm" onClick={verifyAgain} disabled={busy}>
            {busy ? "Checking…" : "Re-check membership"}
          </button>
        </div>
      )}

      {message && state === "done" && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
