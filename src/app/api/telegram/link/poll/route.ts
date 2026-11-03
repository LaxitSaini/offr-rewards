import { requireCsrf, requireUser } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { errors, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { pollTelegramLink } from "@/lib/services/telegram";

export const POST = route(async (req: Request) => {
  await ensureBoot();
  const { user, session } = await requireUser();
  await requireCsrf(session, req);

  const rl = await rateLimit(`tg-poll:${user.id}`, 90, 10 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const result = await pollTelegramLink(user);
  return json(result);
});
