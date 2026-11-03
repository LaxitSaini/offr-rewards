import { env } from "@/lib/env";
import { execute, queryOne, transaction } from "@/lib/db";
import { MINUTE, now } from "@/lib/utils";

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window rate limiter backed by the database so it works across serverless
 * instances. Keys are namespaced per action (and per IP or wallet).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (env.rateLimitDisabled) {
    return { ok: true, limit, remaining: limit, retryAfterSec: 0 };
  }
  const ts = now();
  try {
    return await transaction(async (q) => {
      const row = await q.get<{ window_start: number; count: number }>(
        `SELECT window_start, count FROM rate_limits WHERE key = ?`,
        [key],
      );

      if (!row || ts - Number(row.window_start) >= windowMs) {
        await q.run(
          `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT (key) DO UPDATE SET window_start = ?, count = 1`,
          [key, ts, ts],
        );
        return { ok: true, limit, remaining: limit - 1, retryAfterSec: 0 };
      }

      const count = Number(row.count) + 1;
      if (count > limit) {
        const retryAfterSec = Math.max(1, Math.ceil((Number(row.window_start) + windowMs - ts) / 1000));
        return { ok: false, limit, remaining: 0, retryAfterSec };
      }
      await q.run(`UPDATE rate_limits SET count = ? WHERE key = ?`, [count, key]);
      return { ok: true, limit, remaining: limit - count, retryAfterSec: 0 };
    });
  } catch {
    // A limiter failure must never take the campaign offline; fail open but log.
    console.error("[rate-limit] store unavailable");
    return { ok: true, limit, remaining: limit, retryAfterSec: 0 };
  }
}

/** Opportunistic cleanup so tables cannot grow forever. */
export async function pruneRateLimits(): Promise<void> {
  if (Math.random() > 0.02) return;
  const ts = now();
  try {
    await execute(`DELETE FROM rate_limits WHERE window_start < ?`, [ts - 24 * 60 * MINUTE]);
  } catch {
    /* ignore */
  }
  try {
    await execute(`DELETE FROM sessions WHERE expires_at < ?`, [ts - 7 * 24 * 60 * MINUTE]);
    await execute(`DELETE FROM auth_nonces WHERE expires_at < ?`, [ts - 24 * 60 * MINUTE]);
  } catch {
    /* ignore */
  }
}
