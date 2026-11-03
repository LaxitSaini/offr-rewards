import { getCurrentAdmin } from "@/lib/auth/session";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const ctx = await getCurrentAdmin();
  if (!ctx) return json({ admin: null, csrf: null });
  return json({
    admin: { id: ctx.admin.id, email: ctx.admin.email, lastLoginAt: ctx.admin.last_login_at },
    csrf: ctx.session.csrf,
    expiresAt: Number(ctx.session.expires_at),
  });
});
