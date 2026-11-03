import { query, queryOne } from "@/lib/db";
import type { CampaignSettings } from "@/lib/settings";
import type { UserRow } from "@/lib/users";
import { holdStatusFor, type HoldStatus } from "@/lib/services/holdings";

export interface TaskRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  instructions: string;
  type: string;
  points: number;
  max_awards: number;
  requires_proof: number;
  requires_holding_raw: string | null;
  min_hold_days: number;
  auto_verify: string;
  active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface SubmissionLite {
  id: string;
  task_id: string;
  status: string;
  points_awarded: number;
  verification_state: string;
  verification_detail: string | null;
  proof_url: string | null;
  proof_text: string | null;
  created_at: number;
  reviewed_at: number | null;
  review_note: string | null;
}

export type TaskState =
  | "available"
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "in_progress"
  | "locked";

export interface TaskView extends TaskRow {
  status: TaskState;
  canSubmit: boolean;
  reason?: string;
  approvedCount: number;
  pendingCount: number;
  latestSubmission: SubmissionLite | null;
  isAuto: boolean;
  hold?: Pick<HoldStatus, "holdDays" | "requiredDays" | "qualifies" | "balanceOffr" | "progressPct">;
}

export async function listActiveTasks(): Promise<TaskRow[]> {
  return query<TaskRow>(`SELECT * FROM tasks WHERE active = 1 ORDER BY sort_order ASC, created_at ASC`);
}

export async function listAllTasks(): Promise<TaskRow[]> {
  return query<TaskRow>(`SELECT * FROM tasks ORDER BY sort_order ASC, created_at ASC`);
}

export async function getTaskBySlug(slug: string): Promise<TaskRow | null> {
  return queryOne<TaskRow>(`SELECT * FROM tasks WHERE slug = ?`, [slug]);
}

export async function getTaskById(id: string): Promise<TaskRow | null> {
  return queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id]);
}

export async function getUserSubmissions(userId: string, limit = 50): Promise<SubmissionLite[]> {
  return query<SubmissionLite>(
    `SELECT id, task_id, status, points_awarded, verification_state, verification_detail,
            proof_url, proof_text, created_at, reviewed_at, review_note
     FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export function taskStateFromSubmissions(task: TaskRow, subs: SubmissionLite[]): {
  status: TaskState;
  approvedCount: number;
  pendingCount: number;
  latest: SubmissionLite | null;
} {
  const approvedCount = subs.filter((s) => s.status === "approved" || s.status === "paid").length;
  const pendingCount = subs.filter((s) => s.status === "pending").length;
  const latest = subs[0] ?? null;

  if (approvedCount >= task.max_awards) {
    return { status: "completed", approvedCount, pendingCount, latest };
  }
  if (pendingCount > 0) return { status: "pending", approvedCount, pendingCount, latest };
  if (latest?.status === "rejected") return { status: "rejected", approvedCount, pendingCount, latest };
  if (approvedCount > 0) return { status: "approved", approvedCount, pendingCount, latest };
  return { status: "available", approvedCount, pendingCount, latest };
}

export async function buildTaskViews(args: {
  user: UserRow;
  settings: CampaignSettings;
  campaignLive: boolean;
}): Promise<TaskView[]> {
  const { user, settings, campaignLive } = args;
  const tasks = await listActiveTasks();
  const submissions = await getUserSubmissions(user.id, 200);
  const byTask = new Map<string, SubmissionLite[]>();
  for (const s of submissions) {
    const list = byTask.get(s.task_id) ?? [];
    list.push(s);
    byTask.set(s.task_id, list);
  }

  const needsHold = tasks.some((t) => t.auto_verify === "onchain_hold");
  const hold = needsHold ? await holdStatusFor(user, settings) : null;

  return tasks.map((task) => {
    const subs = byTask.get(task.id) ?? [];
    const state = taskStateFromSubmissions(task, subs);
    const isAuto = task.auto_verify !== "none";

    let status: TaskState = state.status;
    let canSubmit = !isAuto && state.status !== "completed" && state.status !== "pending";
    let reason: string | undefined;

    if (task.auto_verify === "telegram") {
      if (user.telegram_linked_at) {
        if (state.status === "completed") {
          status = "completed";
        } else if (state.status === "pending") {
          status = "pending";
        } else {
          status = "available";
        }
      } else {
        status = "available";
      }
      canSubmit = false;
      if (!campaignLive) {
        canSubmit = false;
        reason = "Campaign is not live.";
      }
    }

    if (task.auto_verify === "onchain_hold" && hold) {
      canSubmit = false;
      status = state.status === "completed" ? "completed" : hold.meetsRequirement ? "available" : "in_progress";
      reason = hold.meetsRequirement
        ? undefined
        : `Hold at least ${settings.holdMinBalanceOffr} OFFR on ${hold.requiredDays} verified day${
            hold.requiredDays === 1 ? "" : "s"
          }. Verified so far: ${hold.holdDays}.`;
    }

    if (task.auto_verify === "x_post" && state.status === "completed") {
      status = "completed";
      canSubmit = false;
    }

    if (Boolean(user.blocked)) {
      canSubmit = false;
      status = "locked";
      reason = "This wallet is restricted. Contact the team on Telegram.";
    } else if (!settings.submissionsOpen || !campaignLive) {
      canSubmit = false;
      if (!reason) reason = "Submissions are currently closed.";
    }

    if (state.status === "pending" && !isAuto) {
      reason = reason ?? "Your submission is waiting for review.";
    }

    return {
      ...task,
      status,
      canSubmit,
      reason,
      approvedCount: state.approvedCount,
      pendingCount: state.pendingCount,
      latestSubmission: state.latest,
      isAuto,
      ...(task.auto_verify === "onchain_hold" && hold
        ? {
            hold: {
              holdDays: hold.holdDays,
              requiredDays: hold.requiredDays,
              qualifies: hold.qualifies,
              balanceOffr: hold.balanceOffr,
              progressPct: hold.progressPct,
            },
          }
        : {}),
    };
  });
}

export async function countSubmissionsByStatus(): Promise<Record<string, number>> {
  const rows = await query<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM submissions GROUP BY status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.c)]));
}
