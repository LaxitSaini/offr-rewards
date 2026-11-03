import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { errors, json, parseJson, route } from "@/lib/http";
import {
  campaignSettingsPatchSchema,
  campaignSettingsSchema,
  getSettings,
  saveSettings,
} from "@/lib/settings";

export const GET = route(async () => {
  await requireAdmin();
  const settings = await getSettings();
  return json({ settings });
});

export const PUT = route(async (req: Request) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const patch = await parseJson(req, campaignSettingsPatchSchema);
  if (Object.keys(patch).length === 0) throw errors.badRequest("No settings supplied.");

  const current = await getSettings();
  const merged = campaignSettingsSchema.safeParse({ ...current, ...patch });
  if (!merged.success) {
    throw errors.badRequest(
      "Some settings are invalid.",
      Object.fromEntries(merged.error.issues.map((i) => [i.path.join("."), i.message])),
    );
  }
  if (merged.data.campaignEndsAt <= merged.data.campaignStartsAt) {
    throw errors.badRequest("Campaign end must be after the start date.");
  }
  const saved = await saveSettings(merged.data, admin.id);

  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "settings.updated",
    targetType: "settings",
    targetId: "campaign",
    meta: { changes: patch },
  });

  return json({ ok: true, settings: saved });
});
