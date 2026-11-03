import { requireUser } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { json, route } from "@/lib/http";
import { getDashboard } from "@/lib/services/dashboard";
import { recomputePoints } from "@/lib/users";

export const GET = route(async () => {
  await ensureBoot();
  const { user, session } = await requireUser();
  // Keep the cached projection honest if a ledger write ever raced.
  const fresh = { ...user, points_cached: await recomputePoints(user.id) };
  const dashboard = await getDashboard(fresh);
  return json({ ...dashboard, csrf: session.csrf });
});
