import { z } from "zod";
import { updateAdminPassword, verifyPassword } from "@/lib/auth/admin";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { errors, json, parseJson, route } from "@/lib/http";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export const POST = route(async (req: Request) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const body = await parseJson(req, schema);

  const valid = await verifyPassword(body.currentPassword, admin.password_hash);
  if (!valid) throw errors.unauthorized("Current password is incorrect.");

  await updateAdminPassword(admin.id, body.newPassword);
  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "admin.password_changed",
    targetType: "admin",
    targetId: admin.id,
  });

  return json({ ok: true });
});
