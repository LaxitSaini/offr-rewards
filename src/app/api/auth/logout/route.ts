import { destroySession, getCurrentUser, requireCsrf } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { json, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const ctx = await getCurrentUser();
  if (ctx) {
    await requireCsrf(ctx.session, req);
    await recordAudit({
      actorType: "user",
      actorId: ctx.user.id,
      action: "user.logout",
      targetType: "user",
      targetId: ctx.user.id,
    });
  }
  await destroySession("user");
  return json({ ok: true });
});
