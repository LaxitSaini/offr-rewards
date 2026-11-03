import { requireAdmin } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { query, queryOne } from "@/lib/db";
import { integrations } from "@/lib/env";
import { json, route } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { trimDecimal } from "@/lib/format";
import { listAudit } from "@/lib/audit";
import { countSubmissionsByStatus } from "@/lib/services/tasks";
import { budgetSnapshot } from "@/lib/services/rewards";
import { totalPaidOffr } from "@/lib/services/payouts";

export const GET = route(async (req: Request) => {
  await ensureBoot();
  await requireAdmin();

  const settings = await getSettings();
  const [participants, verifiedWallets, submissions, statusCounts, paid, audit, pendingPayouts, telegramLinked] =
    await Promise.all([
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users`),
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users WHERE wallet_verified_at IS NOT NULL`),
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM submissions`),
      countSubmissionsByStatus(),
      totalPaidOffr(),
      listAudit(15, 0),
      queryOne<{ c: number; total: number | null }>(
        `SELECT COUNT(*) AS c, SUM(CAST(amount AS DECIMAL(30,6))) AS total FROM payouts WHERE status = 'recorded'`,
      ),
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users WHERE telegram_linked_at IS NOT NULL`),
    ]);

  const topTasks = await query<{ title: string; slug: string; points: number; approvals: number }>(
    `SELECT t.title, t.slug, t.points,
            (SELECT COUNT(*) FROM submissions s WHERE s.task_id = t.id AND s.status IN ('approved','paid')) AS approvals
     FROM tasks t ORDER BY approvals DESC LIMIT 6`,
  );

  return json({
    generatedAt: Date.now(),
    campaign: settings,
    counts: {
      participants: Number(participants?.c ?? 0),
      verifiedWallets: Number(verifiedWallets?.c ?? 0),
      telegramLinked: Number(telegramLinked?.c ?? 0),
      submissions: Number(submissions?.c ?? 0),
      submissionsByStatus: statusCounts,
      pendingPayouts: Number(pendingPayouts?.c ?? 0),
      pendingPayoutOffr: trimDecimal(Number(pendingPayouts?.total ?? 0).toFixed(4)),
    },
    budget: budgetSnapshot(settings.budgetOffr, paid),
    integrations,
    topTasks,
    recentAudit: audit,
  });
});
