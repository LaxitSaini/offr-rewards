import { z } from "zod";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { errors, getClientIp, json, parseJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { reviewSubmission } from "@/lib/services/submissions";

const schema = z.object({
  action: z.enum(["approve", "reject", "revoke"]),
  points: z.number().int().min(0).max(100000).optional(),
  note: z.string().max(1000).optional(),
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const rl = await rateLimit(`review:${admin.id}`, 300, 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw errors.badRequest("Invalid submission id.");
  const body = await parseJson(req, schema);

  const result = await reviewSubmission({
    submissionId: id,
    adminId: admin.id,
    action: body.action,
    points: body.points,
    note: body.note,
    ip: getClientIp(req),
  });

  return json({
    ok: true,
    submission: result.submission,
    pointsAwarded: result.pointsAwarded,
    referralCredited: result.referralCredited,
  });
});
