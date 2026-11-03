import { requireCsrf, requireUser } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { errors, json, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { verifyHoldings } from "@/lib/services/holdings";
import { ensureAutoClaim } from "@/lib/services/submissions";

export const POST = route(async (req: Request) => {
  await ensureBoot();
  const { user, session } = await requireUser();
  await requireCsrf(session, req);

  const rl = await rateLimit(`hold:${user.id}`, 12, 60 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec, "Balance checks are limited to 12 per hour.");

  const settings = await getSettings();
  const outcome = await verifyHoldings(user, settings, "manual");

  let claimCreated = false;
  if (outcome.status.meetsRequirement) {
    const claim = await ensureAutoClaim({
      user,
      taskSlug: "offr-holder",
      contentHash: `hold:${user.id}`,
      verificationState: "verified",
      verificationDetail: `Holding ${outcome.status.balanceOffr} OFFR across ${outcome.status.holdDays} verified day(s).`,
      method: "onchain",
    });
    claimCreated = Boolean(claim);
  }

  return json({
    ok: true,
    hold: outcome.status,
    claimCreated,
    checkedAt: outcome.snapshot?.verified_at,
    balanceRaw: outcome.snapshot?.balance_raw,
  });
});

export const GET = route(async () => {
  const { user } = await requireUser();
  const settings = await getSettings();
  const { holdStatusFor } = await import("@/lib/services/holdings");
  const hold = await holdStatusFor(user, settings);
  return json({ hold });
});
