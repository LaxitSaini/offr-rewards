import { z } from "zod";
import { execute, queryOne } from "@/lib/db";
import { DAY, now, safeJsonParse } from "@/lib/utils";

/**
 * Campaign configuration lives in the database so the team can tune weights,
 * limits and dates without a redeploy. Values are validated on write.
 */
export const campaignSettingsSchema = z.object({
  campaignName: z.string().min(2).max(80).default("OFFR Rewards Season 1"),
  campaignStartsAt: z.number().int().positive().default(() => now()),
  campaignEndsAt: z.number().int().positive().default(() => now() + 20 * DAY),
  signupOpen: z.boolean().default(true),
  submissionsOpen: z.boolean().default(true),

  budgetOffr: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Use a decimal number")
    .default("10000000"),
  offrPerPoint: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Use a decimal number")
    .default("10"),
  minPointsForReward: z.number().int().min(0).default(50),
  maxRewardPerUserOffr: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Use a decimal number")
    .default("250000"),
  maxPointsPerUser: z.number().int().min(0).default(5000),

  holdMinBalanceOffr: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Use a decimal number")
    .default("1000000"),
  holdMinDays: z.number().int().min(0).max(60).default(5),
  holdSnapshotMinHours: z.number().int().min(1).max(168).default(20),
  requireHoldForReward: z.boolean().default(false),

  referralPoints: z.number().int().min(0).max(10000).default(100),
  maxReferralsPerUser: z.number().int().min(0).max(1000).default(25),
  referralRequiresApprovedTask: z.boolean().default(true),

  termsVersion: z.string().min(1).max(40).default("2026-11-v1"),
  payoutNote: z
    .string()
    .max(500)
    .default(
      "Rewards are distributed manually after review. Approval and payout are never guaranteed.",
    ),
});

export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

export const campaignSettingsPatchSchema = campaignSettingsSchema.partial();

export const SETTINGS_KEY = "campaign";

export const DEFAULT_SETTINGS: CampaignSettings = campaignSettingsSchema.parse({});

export async function getSettings(): Promise<CampaignSettings> {
  const row = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [
    SETTINGS_KEY,
  ]);
  if (!row) {
    await saveSettings(DEFAULT_SETTINGS, "system");
    return DEFAULT_SETTINGS;
  }
  const stored = safeJsonParse<Partial<CampaignSettings>>(row.value, {});
  const merged = campaignSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
  if (!merged.success) {
    console.error("[settings] stored configuration is invalid, using defaults");
    return DEFAULT_SETTINGS;
  }
  return merged.data;
}

export async function saveSettings(
  value: CampaignSettings,
  updatedBy: string,
): Promise<CampaignSettings> {
  const validated = campaignSettingsSchema.parse(value);
  const payload = JSON.stringify(validated);
  await execute(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = ?, updated_by = ?`,
    [SETTINGS_KEY, payload, now(), updatedBy, payload, now(), updatedBy],
  );
  return validated;
}

export function campaignWindow(settings: CampaignSettings) {
  const ts = now();
  return {
    started: ts >= settings.campaignStartsAt,
    ended: ts > settings.campaignEndsAt,
    live: ts >= settings.campaignStartsAt && ts <= settings.campaignEndsAt,
  };
}
