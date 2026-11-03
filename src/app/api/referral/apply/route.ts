import { z } from "zod";
import { requireCsrf, requireUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { errors, json, parseJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { attachReferral, getUserById } from "@/lib/users";

const schema = z.object({ code: z.string().trim().min(4).max(16) });

export const POST = route(async (req: Request) => {
  const { user, session } = await requireUser();
  await requireCsrf(session, req);

  if (user.blocked) throw errors.forbidden("This wallet is restricted.");

  const rl = await rateLimit(`referral:${user.id}`, 6, 60 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const { code } = await parseJson(req, schema);
  const result = await attachReferral(user.id, code.toUpperCase());
  if (!result.ok) throw errors.badRequest(result.reason ?? "Referral could not be applied.");

  const fresh = await getUserById(user.id);
  await recordAudit({
    actorType: "user",
    actorId: user.id,
    action: "referral.applied",
    targetType: "user",
    targetId: user.id,
    meta: { code: code.toUpperCase() },
  });

  return json({ ok: true, referredBy: fresh?.referred_by ?? null });
});
