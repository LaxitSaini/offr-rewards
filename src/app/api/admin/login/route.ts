import { z } from "zod";
import { authenticateAdmin, provisionAdminFromEnv } from "@/lib/auth/admin";
import { createSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { ensureBoot } from "@/lib/bootstrap";
import { errors, getClientIp, getUserAgent, json, parseJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const POST = route(async (req: Request) => {
  await ensureBoot();
  const ip = getClientIp(req);
  // Two layers: per-IP burst control and per-account lockout (see admin.ts).
  const ipLimit = await rateLimit(`admin-login:${ip}`, 10, 15 * 60 * 1000);
  if (!ipLimit.ok) throw errors.tooMany(ipLimit.retryAfterSec, "Too many attempts from this network.");

  const body = await parseJson(req, schema);
  const emailLimit = await rateLimit(`admin-login-email:${body.email.toLowerCase()}`, 10, 15 * 60 * 1000);
  if (!emailLimit.ok) throw errors.tooMany(emailLimit.retryAfterSec, "Too many attempts for this account.");

  const provisioned = await provisionAdminFromEnv();
  if (provisioned.created) {
    console.info("[admin] first admin bootstrapped from environment");
  }

  const { admin } = await authenticateAdmin(body.email, body.password);
  const session = await createSession({
    kind: "admin",
    adminId: admin.id,
    ip,
    userAgent: getUserAgent(req),
  });

  await recordAudit({
    actorType: "admin",
    actorId: admin.id,
    action: "admin.login",
    targetType: "admin",
    targetId: admin.id,
    ip,
  });

  return json({
    ok: true,
    csrf: session.csrf,
    expiresAt: session.expiresAt,
    admin: { id: admin.id, email: admin.email },
  });
});
