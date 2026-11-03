import { z } from "zod";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { execute, queryOne } from "@/lib/db";
import { errors, json, parseJson, route } from "@/lib/http";
import { recordAudit } from "@/lib/audit";
import { getTaskById, listAllTasks } from "@/lib/services/tasks";
import { AUTO_VERIFY_KINDS, TASK_TYPES } from "@/lib/constants";
import { now } from "@/lib/utils";

const patchSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(2000).optional(),
  type: z.enum(TASK_TYPES).optional(),
  points: z.number().int().min(0).max(100000).optional(),
  maxAwards: z.number().int().min(1).max(100).optional(),
  requiresProof: z.boolean().optional(),
  autoVerify: z.enum(AUTO_VERIFY_KINDS).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const { id } = await ctx.params;
  const body = await parseJson(req, patchSchema);
  const task = await getTaskById(id);
  if (!task) throw errors.notFound("Task not found.");

  const map: Record<string, string> = {
    maxAwards: "max_awards",
    requiresProof: "requires_proof",
    autoVerify: "auto_verify",
    sortOrder: "sort_order",
  };
  const assignments: string[] = [];
  const params: (string | number)[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    const column = map[key] ?? key;
    assignments.push(`${column} = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number));
  }
  if (assignments.length === 0) throw errors.badRequest("No changes supplied.");
  assignments.push(`updated_at = ?`);
  params.push(now(), id);

  await execute(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`, params);

  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "task.updated",
    targetType: "task",
    targetId: id,
    meta: { slug: task.slug, changes: body },
  });

  return json({ ok: true, tasks: await listAllTasks() });
});

export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const { id } = await ctx.params;
  const task = await getTaskById(id);
  if (!task) throw errors.notFound("Task not found.");

  const used = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM submissions WHERE task_id = ?`, [
    id,
  ]);
  if (Number(used?.c ?? 0) > 0) {
    // Preserve history: deactivate instead of deleting submissions.
    await execute(`UPDATE tasks SET active = 0, updated_at = ? WHERE id = ?`, [now(), id]);
    await recordAudit({
      actorType: "admin",
      actorId: admin.id,
      action: "task.deactivated",
      targetType: "task",
      targetId: id,
      meta: { slug: task.slug, reason: "has submissions" },
    });
    return json({ ok: true, deactivated: true, tasks: await listAllTasks() });
  }

  await execute(`DELETE FROM tasks WHERE id = ?`, [id]);
  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "task.deleted",
    targetType: "task",
    targetId: id,
    meta: { slug: task.slug },
  });
  return json({ ok: true, tasks: await listAllTasks() });
});
