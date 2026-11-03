import { z } from "zod";
import { requireCsrf, requireUser } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { errors, getClientIp, json, parseJson, route } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { submitTask } from "@/lib/services/submissions";

const schema = z.object({
  proofUrl: z.string().max(600).optional().nullable(),
  proofText: z.string().max(2000).optional().nullable(),
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  await ensureBoot();
  const { user, session } = await requireUser();
  await requireCsrf(session, req);
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw errors.badRequest("Unknown task.");
  const body = await parseJson(req, schema);
  const settings = await getSettings();

  const submission = await submitTask({
    user,
    taskSlug: slug,
    proofUrl: body.proofUrl ?? null,
    proofText: body.proofText ?? null,
    ip: getClientIp(req),
    settings,
  });

  return json({
    ok: true,
    submission: {
      id: submission.id,
      status: submission.status,
      verificationState: submission.verification_state,
      verificationDetail: submission.verification_detail,
      createdAt: submission.created_at,
    },
  });
});
