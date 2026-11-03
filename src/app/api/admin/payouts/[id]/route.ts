import { z } from "zod";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { errors, json, parseJson, route } from "@/lib/http";
import { revalidatePayout, voidPayout } from "@/lib/services/payouts";

const schema = z.object({
  action: z.enum(["revalidate", "void"]),
  reason: z.string().max(300).optional(),
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw errors.badRequest("Invalid payout id.");
  const body = await parseJson(req, schema);

  if (body.action === "revalidate") {
    const payout = await revalidatePayout(id, admin.id);
    return json({ ok: true, payout });
  }
  await voidPayout(id, admin.id, body.reason ?? "No reason provided");
  return json({ ok: true });
});
