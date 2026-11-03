import { z } from "zod";
import { env } from "@/lib/env";
import { ApiError, errors, getClientIp, json, parseJson, route } from "@/lib/http";
import { createNonce } from "@/lib/auth/nonce";
import { rateLimit } from "@/lib/ratelimit";
import { isAddress } from "@/lib/utils";
import { ensureBoot } from "@/lib/bootstrap";

const schema = z.object({ address: z.string().min(42).max(42) });

export const POST = route(async (req: Request) => {
  await ensureBoot();
  const ip = getClientIp(req);
  const rl = await rateLimit(`nonce:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec);

  const { address } = await parseJson(req, schema);
  if (!isAddress(address)) throw errors.badRequest("That is not a valid EVM wallet address.");

  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (env.isProd ? "https" : "http");
  const uri = `${proto}://${host}`;

  const { message, expiresAt } = await createNonce({
    wallet: address,
    domain: host,
    uri,
  });

  return json({ message, expiresAt, chainId: 8453 });
});

export const GET = route(async () => {
  throw new ApiError(405, "method_not_allowed", "Use POST to request a sign-in message.");
});
