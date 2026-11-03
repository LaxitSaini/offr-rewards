import { requireAdmin } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { query } from "@/lib/db";
import { errors, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { listAllTasks } from "@/lib/services/tasks";
import { listSubmissionsForAdmin } from "@/lib/services/submissions";

export const GET = route(async (req: Request) => {
  await ensureBoot();
  const { admin } = await requireAdmin();
  const rl = await rateLimit(`admin-subs:${admin.id}`, 180, 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const taskId = url.searchParams.get("task") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const perPage = 25;

  const [submissions, tasks] = await Promise.all([
    listSubmissionsForAdmin({ status, taskId, limit: perPage, offset: (page - 1) * perPage }),
    listAllTasks(),
  ]);

  const verifications = await query<{
    submission_id: string;
    kind: string;
    status: string;
    method: string;
    detail: string | null;
    checked_at: number;
  }>(
    `SELECT submission_id, kind, status, method, detail, checked_at FROM verifications
     WHERE submission_id IS NOT NULL ORDER BY checked_at DESC LIMIT 300`,
  );
  const bySubmission = new Map<string, typeof verifications>();
  for (const v of verifications) {
    const list = bySubmission.get(v.submission_id) ?? [];
    list.push(v);
    bySubmission.set(v.submission_id, list);
  }

  return json({
    page,
    perPage,
    status,
    tasks: tasks.map((t) => ({ id: t.id, slug: t.slug, title: t.title, type: t.type, points: t.points })),
    submissions: submissions.map((row) => {
      const r = row as Record<string, unknown> & { id: string };
      return {
        ...r,
        verifications: bySubmission.get(r.id) ?? [],
        risk: "",
      };
    }),
  });
});
