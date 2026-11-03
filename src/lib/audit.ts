import { newId, query, queryOne, execute } from "@/lib/db";
import { now, truncate } from "@/lib/utils";

export type ActorType = "user" | "admin" | "system" | "anonymous";

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, meta, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("aud"),
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.meta ? truncate(JSON.stringify(input.meta), 4000) : null,
        input.ip ?? null,
        now(),
      ],
    );
  } catch (err) {
    console.error("[audit] failed to write entry", (err as Error).message);
  }
}

export interface AuditRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: string | null;
  ip: string | null;
  created_at: number;
  actor_email?: string | null;
  actor_wallet?: string | null;
}

export async function listAudit(limit = 100, offset = 0): Promise<AuditRow[]> {
  return query<AuditRow>(
    `SELECT a.*, ad.email AS actor_email, u.wallet AS actor_wallet
     FROM audit_log a
     LEFT JOIN admins ad ON ad.id = a.actor_id
     LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

export async function countAudit(): Promise<number> {
  const row = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_log`);
  return Number(row?.c ?? 0);
}
