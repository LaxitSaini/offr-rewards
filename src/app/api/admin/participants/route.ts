import { requireAdmin } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { query, queryOne } from "@/lib/db";
import { errors, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { shortAddress, trimDecimal } from "@/lib/format";

export const GET = route(async (req: Request) => {
  await ensureBoot();
  const { admin } = await requireAdmin();
  const rl = await rateLimit(`admin-participants:${admin.id}`, 120, 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;

  let where = "";
  const params: (string | number)[] = [];
  if (q) {
    where = `WHERE u.wallet LIKE ? OR u.x_username LIKE ? OR u.telegram_username LIKE ? OR u.referral_code LIKE ?`;
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like, like);
  }

  const rows = await query<{
    id: string;
    wallet: string;
    x_username: string | null;
    telegram_username: string | null;
    points_cached: number;
    hold_days: number;
    created_at: number;
    last_seen_at: number | null;
    blocked: number;
    status: string;
    risk_flags: string | null;
    referral_code: string;
    submissions: number;
    approved: number;
    paid_offr: string | null;
  }>(
    `SELECT u.id, u.wallet, u.x_username, u.telegram_username, u.points_cached, u.hold_days, u.created_at,
            u.last_seen_at, u.blocked, u.status, u.risk_flags, u.referral_code,
            (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id) AS submissions,
            (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id AND s.status IN ('approved','paid')) AS approved,
            (SELECT SUM(CAST(p.amount AS DECIMAL(30,6))) FROM payouts p WHERE p.user_id = u.id AND p.status IN ('recorded','verified')) AS paid_offr
     FROM users u ${where}
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  const total = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users u ${where}`, params);

  return json({
    page,
    perPage,
    total: Number(total?.c ?? 0),
    participants: rows.map((r) => ({
      ...r,
      walletShort: shortAddress(r.wallet, 6),
      paidOffr: trimDecimal(Number(r.paid_offr ?? 0).toFixed(4)),
      riskFlags: r.risk_flags ? safeParse(r.risk_flags) : [],
    })),
  });
});

function safeParse(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
