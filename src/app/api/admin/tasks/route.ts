import { z } from "zod";
import { requireAdmin, requireCsrf } from "@/lib/auth/session";
import { execute, newId } from "@/lib/db";
import { errors, json, parseJson, route } from "@/lib/http";
import { listAllTasks } from "@/lib/services/tasks";
import { AUTO_VERIFY_KINDS, TASK_TYPES } from "@/lib/constants";
import { now } from "@/lib/utils";

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes"),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  instructions: z.string().trim().max(2000).default(""),
  type: z.enum(TASK_TYPES),
  points: z.number().int().min(0).max(100000),
  maxAwards: z.number().int().min(1).max(100).default(1),
  requiresProof: z.boolean().default(true),
  autoVerify: z.enum(AUTO_VERIFY_KINDS).default("none"),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(100),
});

export const GET = route(async () => {
  const { admin } = await requireAdmin();
  void admin;
  const tasks = await listAllTasks();
  return json({ tasks });
});

export const POST = route(async (req: Request) => {
  const { admin, session } = await requireAdmin();
  await requireCsrf(session, req);
  const body = await parseJson(req, createSchema);
  const ts = now();
  try {
    await execute(
      `INSERT INTO tasks (id, slug, title, description, instructions, type, points, max_awards,
        requires_proof, requires_holding_raw, min_hold_days, auto_verify, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)`,
      [
        newId("task"),
        body.slug,
        body.title,
        body.description,
        body.instructions,
        body.type,
        body.points,
        body.maxAwards,
        body.requiresProof ? 1 : 0,
        body.autoVerify,
        body.active ? 1 : 0,
        body.sortOrder,
        ts,
        ts,
      ],
    );
  } catch (err) {
    if (/unique|duplicate/i.test((err as Error).message ?? "")) {
      throw errors.conflict("A task with that slug already exists.");
    }
    throw err;
  }
  const { recordAudit } = await import("@/lib/audit");
  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "task.created",
    targetType: "task",
    targetId: body.slug,
    meta: body,
  });
  return json({ ok: true, tasks: await listAllTasks() });
});
