import { ensureBoot } from "@/lib/bootstrap";
import { errors, getClientIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getLeaderboard } from "@/lib/services/dashboard";

export const GET = route(async (req: Request) => {
  await ensureBoot();
  const rl = await rateLimit(`leaderboard:${getClientIp(req)}`, 120, 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const entries = await getLeaderboard(limit);
  return json({ entries, updatedAt: Date.now() });
});
