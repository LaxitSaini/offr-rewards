import { z } from "zod";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { errors, json, parseJson, route } from "@/lib/http";
import { getUserById, updateUser } from "@/lib/users";
import { query } from "@/lib/db";

const schema = z.object({
  action: z.enum(["block", "unblock", "note"]),
  note: z.string().max(1000).optional(),
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const { id } = await ctx.params;
  const body = await parseJson(req, schema);

  const user = await getUserById(id);
  if (!user) throw errors.notFound("Participant not found.");

  if (body.action === "block") {
    await updateUser(user.id, { blocked: 1, status: "blocked", notes: body.note ?? user.notes });
  } else if (body.action === "unblock") {
    await updateUser(user.id, { blocked: 0, status: "active", notes: body.note ?? user.notes });
  } else {
    await updateUser(user.id, { notes: body.note ?? "" });
  }

  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: `user.${body.action}`,
    targetType: "user",
    targetId: user.id,
    meta: { wallet: user.wallet, note: body.note ?? null },
  });

  return json({ ok: true });
});

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const user = await getUserById(id);
  if (!user) throw errors.notFound("Participant not found.");
  const submissions = await query(
    `SELECT s.*, t.title AS task_title, t.slug AS task_slug FROM submissions s
     JOIN tasks t ON t.id = s.task_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 100`,
    [id],
  );
  const payouts = await query(`SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [id]);
  const snapshots = await query(
    `SELECT * FROM holdings_snapshots WHERE user_id = ? ORDER BY verified_at DESC LIMIT 20`,
    [id],
  );
  const verifications = await query(
    `SELECT * FROM verifications WHERE user_id = ? ORDER BY checked_at DESC LIMIT 30`,
    [id],
  );
  return json({ user, submissions, payouts, snapshots, verifications });
});
