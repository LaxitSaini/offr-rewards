import { ensureBoot } from "@/lib/bootstrap";
import { errors, getClientIp, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getPublicStats, getLeaderboard } from "@/lib/services/dashboard";

export const GET = route(async (req: Request) => {
  await ensureBoot();
  const rl = await rateLimit(`stats:${getClientIp(req)}`, 120, 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);
  const [stats, leaderboard] = await Promise.all([getPublicStats(), getLeaderboard(5)]);
  return json({ stats, top: leaderboard });
});
