import { requireCsrf, requireUser } from "@/lib/auth/session";
import { errors, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { startTelegramLink } from "@/lib/services/telegram";

export const POST = route(async (req: Request) => {
  const { user, session } = await requireUser();
  await requireCsrf(session, req);
  const rl = await rateLimit(`tg-start:${user.id}`, 10, 60 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const link = await startTelegramLink(user);
  return json({ ok: true, url: link.url, expiresAt: link.expiresAt });
});
