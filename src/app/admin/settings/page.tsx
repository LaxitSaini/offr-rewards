"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/admin-provider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Alert } from "@/components/ui";
import { toDateInputValue, fromDateInputValue } from "@/lib/format";

interface Settings {
  campaignName: string;
  campaignStartsAt: number;
  campaignEndsAt: number;
  signupOpen: boolean;
  submissionsOpen: boolean;
  budgetOffr: string;
  offrPerPoint: string;
  minPointsForReward: number;
  maxRewardPerUserOffr: string;
  maxPointsPerUser: number;
  holdMinBalanceOffr: string;
  holdMinDays: number;
  holdSnapshotMinHours: number;
  requireHoldForReward: boolean;
  referralPoints: number;
  maxReferralsPerUser: number;
  referralRequiresApprovedTask: boolean;
  termsVersion: string;
  payoutNote: string;
}

export default function AdminSettingsPage() {
  const { csrf } = useAdmin();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ settings: Settings }>("/api/admin/settings");
      setSettings(data.settings);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiFetch<{ settings: Settings }>("/api/admin/settings", {
        method: "PUT",
        csrf,
        body: settings,
      });
      setSettings(data.settings);
      setMessage("Campaign settings saved. Changes apply immediately.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return error ? <Alert tone="error">{error}</Alert> : <div className="skeleton h-40 w-full" />;
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <form className="space-y-4" onSubmit={save}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Configuration</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Campaign settings</h1>
          <p className="mt-1 text-[12px] text-white/40">
            Weights, caps and dates are stored in the database. Every change is written to the audit log.
          </p>
        </div>
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <section className="card card-pad grid gap-3 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-[13px] font-semibold text-white/80">Campaign window</h2>
        <div className="sm:col-span-2">
          <label className="label">Campaign name</label>
          <input
            className="input"
            value={settings.campaignName}
            onChange={(e) => set("campaignName", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Starts</label>
          <input
            className="input"
            type="date"
            value={toDateInputValue(settings.campaignStartsAt)}
            onChange={(e) => set("campaignStartsAt", fromDateInputValue(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Ends</label>
          <input
            className="input"
            type="date"
            value={toDateInputValue(settings.campaignEndsAt)}
            onChange={(e) => set("campaignEndsAt", fromDateInputValue(e.target.value))}
          />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-white/60">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={settings.submissionsOpen}
            onChange={(e) => set("submissionsOpen", e.target.checked)}
          />
          Submissions open
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-white/60">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={settings.signupOpen}
            onChange={(e) => set("signupOpen", e.target.checked)}
          />
          New sign-ups open
        </label>
      </section>

      <section className="card card-pad grid gap-3 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-[13px] font-semibold text-white/80">Reward engine</h2>
        <div>
          <label className="label">Campaign budget (OFFR)</label>
          <input
            className="input"
            inputMode="decimal"
            value={settings.budgetOffr}
            onChange={(e) => set("budgetOffr", e.target.value)}
          />
        </div>
        <div>
          <label className="label">OFFR per point</label>
          <input
            className="input"
            inputMode="decimal"
            value={settings.offrPerPoint}
            onChange={(e) => set("offrPerPoint", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Max reward per participant (OFFR)</label>
          <input
            className="input"
            inputMode="decimal"
            value={settings.maxRewardPerUserOffr}
            onChange={(e) => set("maxRewardPerUserOffr", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Min points to qualify</label>
          <input
            className="input"
            type="number"
            min={0}
            value={settings.minPointsForReward}
            onChange={(e) => set("minPointsForReward", Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Max points per participant</label>
          <input
            className="input"
            type="number"
            min={0}
            value={settings.maxPointsPerUser}
            onChange={(e) => set("maxPointsPerUser", Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Payout note (shown to users)</label>
          <input
            className="input"
            value={settings.payoutNote}
            onChange={(e) => set("payoutNote", e.target.value)}
          />
        </div>
      </section>

      <section className="card card-pad grid gap-3 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-[13px] font-semibold text-white/80">Holding rules</h2>
        <div>
          <label className="label">Minimum balance (OFFR)</label>
          <input
            className="input"
            inputMode="decimal"
            value={settings.holdMinBalanceOffr}
            onChange={(e) => set("holdMinBalanceOffr", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Required hold days</label>
          <input
            className="input"
            type="number"
            min={0}
            max={60}
            value={settings.holdMinDays}
            onChange={(e) => set("holdMinDays", Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Min hours between counted checks</label>
          <input
            className="input"
            type="number"
            min={1}
            max={168}
            value={settings.holdSnapshotMinHours}
            onChange={(e) => set("holdSnapshotMinHours", Number(e.target.value))}
          />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-white/60">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={settings.requireHoldForReward}
            onChange={(e) => set("requireHoldForReward", e.target.checked)}
          />
          Require verified holding for any reward
        </label>
      </section>

      <section className="card card-pad grid gap-3 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-[13px] font-semibold text-white/80">Referrals</h2>
        <div>
          <label className="label">Points per credited referral</label>
          <input
            className="input"
            type="number"
            min={0}
            value={settings.referralPoints}
            onChange={(e) => set("referralPoints", Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Max credited referrals per wallet</label>
          <input
            className="input"
            type="number"
            min={0}
            value={settings.maxReferralsPerUser}
            onChange={(e) => set("maxReferralsPerUser", Number(e.target.value))}
          />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-white/60">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={settings.referralRequiresApprovedTask}
            onChange={(e) => set("referralRequiresApprovedTask", e.target.checked)}
          />
          Credit only after the invited wallet gets an approval
        </label>
        <div>
          <label className="label">Terms version</label>
          <input
            className="input"
            value={settings.termsVersion}
            onChange={(e) => set("termsVersion", e.target.value)}
          />
        </div>
      </section>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
