"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/client/api";
import {
  connectWallet,
  detectWallets,
  signInWithWallet,
  type WalletOption,
} from "@/lib/client/wallet";

export interface SessionUser {
  id: string;
  wallet: string;
  walletShort: string;
  points: number;
  referralCode: string;
  blocked: boolean;
}

interface WalletContextValue {
  user: SessionUser | null;
  csrf: string | null;
  wallets: WalletOption[];
  status: "loading" | "disconnected" | "connected";
  connecting: boolean;
  error: string | null;
  notice: string | null;
  connect: (walletId: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearMessages: () => void;
  setNotice: (value: string | null) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const REF_STORAGE_KEY = "offr:referral";

export function readPendingReferral(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("ref");
  if (fromUrl) {
    const clean = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (clean) {
      try {
        window.localStorage.setItem(REF_STORAGE_KEY, clean);
      } catch {
        /* storage may be blocked */
      }
      return clean;
    }
  }
  try {
    return window.localStorage.getItem(REF_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    window.localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [status, setStatus] = useState<"loading" | "disconnected" | "connected">("loading");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: SessionUser | null; csrf: string | null }>(
        "/api/auth/session",
      );
      if (!mounted.current) return;
      if (data.user) {
        setUser(data.user);
        setCsrf(data.csrf);
        setStatus("connected");
      } else {
        setUser(null);
        setCsrf(null);
        setStatus("disconnected");
      }
    } catch {
      if (!mounted.current) return;
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setWallets(detectWallets());
    void refresh();
    const timer = window.setTimeout(() => setWallets(detectWallets()), 1200);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const connect = useCallback(
    async (walletId: string) => {
      setError(null);
      setNotice(null);
      const option = detectWallets().find((w) => w.id === walletId);
      if (!option) {
        setError(
          "No compatible wallet found. Install MetaMask, Coinbase Wallet, Rabby or Brave and reload this page.",
        );
        return false;
      }
      setConnecting(true);
      try {
        const { address } = await connectWallet(option.provider);
        const referral = readPendingReferral();
        const { csrf: token } = await signInWithWallet({
          provider: option.provider,
          address,
          referralCode: referral,
        });
        setCsrf(token);
        clearPendingReferral();
        await refresh();
        router.refresh();
        setNotice("Wallet verified. Welcome to OFFR Rewards.");
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [refresh, router],
  );

  const disconnect = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", csrf });
    } catch {
      /* session may already be gone */
    }
    setUser(null);
    setCsrf(null);
    setStatus("disconnected");
    setNotice("Signed out.");
    router.refresh();
  }, [csrf, router]);

  const value = useMemo<WalletContextValue>(
    () => ({
      user,
      csrf,
      wallets,
      status,
      connecting,
      error,
      notice,
      connect,
      disconnect,
      refresh,
      clearMessages: () => {
        setError(null);
        setNotice(null);
      },
      setNotice,
    }),
    [user, csrf, wallets, status, connecting, error, notice, connect, disconnect, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
