"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiClientError } from "@/lib/client/api";

interface AdminInfo {
  id: string;
  email: string;
  lastLoginAt: number | null;
}

interface AdminContextValue {
  admin: AdminInfo | null;
  csrf: string | null;
  ready: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ admin: AdminInfo | null; csrf: string | null }>("/api/admin/session");
      setAdmin(data.admin);
      setCsrf(data.csrf);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        setAdmin(null);
        setCsrf(null);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/admin/logout", { method: "POST", csrf });
    } catch {
      /* ignore */
    }
    setAdmin(null);
    setCsrf(null);
    router.replace("/admin-login");
    router.refresh();
  }, [csrf, router]);

  const value = useMemo(
    () => ({ admin, csrf, ready, logout, refresh }),
    [admin, csrf, ready, logout, refresh],
  );
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { admin, ready } = useAdmin();
  const router = useRouter();

  useEffect(() => {
    if (ready && !admin) router.replace("/admin-login");
  }, [ready, admin, router]);

  if (!ready) {
    return (
      <div className="shell py-20">
        <div className="skeleton mx-auto h-24 w-full max-w-md" />
      </div>
    );
  }
  if (!admin) {
    return (
      <div className="shell py-20 text-center">
        <p className="text-sm text-white/50">Admin session required. Redirecting…</p>
        <a href="/admin-login" className="link mt-2 inline-block text-sm">
          Open admin login
        </a>
      </div>
    );
  }
  return <>{children}</>;
}
