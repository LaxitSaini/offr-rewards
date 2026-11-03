import { z } from "zod";
import { getChain } from "@/lib/chain";
import { recordAudit } from "@/lib/audit";
import { consumeNonce } from "@/lib/auth/nonce";
import { createSession } from "@/lib/auth/session";
import { ensureBoot } from "@/lib/bootstrap";
import { errors, getClientIp, getUserAgent, json, parseJson, route } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/ratelimit";
import { attachReferral, evaluateRisk, getOrCreateUser, getUserByWallet, updateUser } from "@/lib/users";
import { isAddress, now } from "@/lib/utils";

const schema = z.object({
  address: z.string().min(42).max(42),
  signature: z.string().min(10).max(500),
  referralCode: z.string().trim().max(16).optional().nullable(),
});

export const POST = route(async (req: Request) => {
  await ensureBoot();
  const ip = getClientIp(req);
  const rl = await rateLimit(`verify:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const body = await parseJson(req, schema);
  if (!isAddress(body.address)) throw errors.badRequest("That is not a valid EVM wallet address.");
  if (!/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    throw errors.badRequest("Wallet returned a malformed signature.");
  }

  const { message } = await consumeNonce(body.address);

  const valid = await getChain()
    .verifySignature({
      address: body.address as `0x${string}`,
      message,
      signature: body.signature as `0x${string}`,
    })
    .catch(() => false);

  if (!valid) {
    throw errors.unauthorized("Signature verification failed. Please sign the message with the wallet you connected.");
  }

  const settings = await getSettings();
  const existing = await getUserByWallet(body.address);
  if (!existing && !settings.signupOpen) {
    throw errors.forbidden(
      "New registrations are currently closed. Follow @OFFR35 to hear when the next season opens.",
    );
  }

  const { user, created } = await getOrCreateUser({
    wallet: body.address,
    ip,
    referralCode: body.referralCode ?? null,
  });

  if (user.blocked) throw errors.forbidden("This wallet has been restricted by the campaign team.");

  if (!user.wallet_verified_at) {
    await updateUser(user.id, { wallet_verified_at: now() });
  }

  if (created && body.referralCode) {
    await attachReferral(user.id, body.referralCode);
  }

  const flags = await evaluateRisk(user, ip);
  if (flags.length) {
    await updateUser(user.id, {
      risk_flags: JSON.stringify(flags),
      risk_score: flags.length * 20,
    });
  }

  const session = await createSession({
    kind: "user",
    userId: user.id,
    ip,
    userAgent: getUserAgent(req),
  });

  await recordAudit({
    actorType: "user",
    actorId: user.id,
    action: created ? "user.registered" : "user.login",
    targetType: "user",
    targetId: user.id,
    meta: { wallet: user.wallet, riskFlags: flags },
    ip,
  });

  return json({
    ok: true,
    created,
    csrf: session.csrf,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      wallet: user.wallet,
      points: user.points_cached,
      referralCode: user.referral_code,
      verifiedAt: user.wallet_verified_at ?? now(),
    },
  });
});
