"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/wallet-provider";
import { shortAddress } from "@/lib/format";

export function ConnectButton({
  size = "md",
  full = false,
  label = "Connect wallet",
}: {
  size?: "sm" | "md";
  full?: boolean;
  label?: string;
}) {
  const { status, user, wallets, connect, connecting, error, disconnect, clearMessages } = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    void connect(id);
  };

  if (status === "loading") {
    return <div className={`skeleton h-10 ${full ? "w-full" : "w-32"}`} aria-hidden />;
  }

  if (user) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          className={`btn-secondary ${size === "sm" ? "btn-sm" : ""} ${full ? "w-full justify-between" : ""}`}
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(184,255,60,0.9)]" />
            <span className="mono">{shortAddress(user.wallet, 4)}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {menu && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setMenu(false)}
            />
            <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-2xl">
              <div className="border-b border-white/[0.06] px-3.5 py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/60">Connected wallet</p>
                <p className="mono mt-1 text-white/80">{shortAddress(user.wallet, 6)}</p>
              </div>
              <Link
                href="/dashboard"
                className="block px-3.5 py-2.5 text-sm text-white/80 hover:bg-white/[0.05]"
                onClick={() => setMenu(false)}
              >
                Dashboard
              </Link>
              <button
                type="button"
                className="w-full px-3.5 py-2.5 text-left text-sm text-white/60 hover:bg-white/[0.05]"
                onClick={async () => {
                  setMenu(false);
                  await disconnect();
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          clearMessages();
          setLocalError(null);
          if (wallets.length === 1) {
            void connect(wallets[0].id);
          } else {
            setOpen(true);
          }
        }}
        disabled={connecting}
        className={`btn-primary ${size === "sm" ? "btn-sm" : ""} ${full ? "w-full" : ""}`}
      >
        {connecting ? (
          <>
            <Spinner /> Verifying…
          </>
        ) : (
          <>
            {label}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </>
        )}
      </button>

      {(error || localError) && (
        <p className="mt-2 max-w-xs text-xs leading-relaxed text-danger" role="alert">
          {localError ?? error}
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-ink-850 p-5 shadow-2xl animate-riseIn">
            <div className="flex items-start justify-between">
              <div>
                <p className="kicker">Base Mainnet · 8453</p>
                <h3 className="mt-1 text-lg font-semibold">Choose a wallet</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-white/60 hover:bg-white/[0.06] hover:text-white"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {wallets.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-ink-900 p-4 text-sm text-white/60">
                  No browser wallet detected. Install{" "}
                  <a className="link" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                    MetaMask
                  </a>{" "}
                  or{" "}
                  <a
                    className="link"
                    href="https://www.coinbase.com/wallet/downloads"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Coinbase Wallet
                  </a>
                  , then reload.
                </div>
              )}
              {wallets.map((wallet) => (
                <button
                  key={wallet.id}
                  type="button"
                  onClick={() => pick(wallet.id)}
                  disabled={connecting}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium hover:border-lime/40 hover:bg-white/[0.06]"
                >
                  <span>{wallet.name}</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              ))}
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-white/60">
              OFFR Rewards only asks for a signature to prove wallet ownership. It never requests a seed
              phrase, private key, or any transaction.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
