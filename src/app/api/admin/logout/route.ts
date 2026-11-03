import { destroySession, getCurrentAdmin, requireCsrf } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { json, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const ctx = await getCurrentAdmin();
  if (ctx) {
    await requireCsrf(ctx.session, req);
    await recordAudit({
      actorType: "admin",
      actorId: ctx.admin.id,
      action: "admin.logout",
      targetType: "admin",
      targetId: ctx.admin.id,
    });
  }
  await destroySession("admin");
  return json({ ok: true });
});
