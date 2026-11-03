import { getCurrentUser } from "@/lib/auth/session";
import { json, route } from "@/lib/http";
import { shortAddress } from "@/lib/utils";

export const GET = route(async () => {
  const ctx = await getCurrentUser();
  if (!ctx) return json({ user: null, csrf: null });
  return json({
    user: {
      id: ctx.user.id,
      wallet: ctx.user.wallet,
      walletShort: shortAddress(ctx.user.wallet, 6),
      points: Number(ctx.user.points_cached),
      referralCode: ctx.user.referral_code,
      blocked: Boolean(ctx.user.blocked),
    },
    csrf: ctx.session.csrf,
    expiresAt: Number(ctx.session.expires_at),
  });
});
