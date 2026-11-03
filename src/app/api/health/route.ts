import { queryOne } from "@/lib/db";
import { integrations, env } from "@/lib/env";
import { getChain } from "@/lib/chain";
import { json, route } from "@/lib/http";
import { sanitizeDbError } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Liveness + configuration probe. Never returns secrets. */
function firstLine(message: string): string {
  return message.split("\n")[0]!.slice(0, 120);
}

export const GET = route(async () => {
  let dbOk = false;
  let dbError: string | null = null;
  try {
    const row = await queryOne<{ ok: number }>(`SELECT 1 AS ok`);
    dbOk = Number(row?.ok ?? 0) === 1;
  } catch (err) {
    // The reason is useful for a free-tier operator (missing database, bad
    // password, refused connection); the connection string never is.
    dbError = sanitizeDbError((err as Error).message ?? "database unavailable");
    console.error("[health] database check failed:", firstLine(dbError));
  }

  let tokenMeta: { symbol: string; decimals: number; source: string } | null = null;
  let chainOk = false;
  try {
    const meta = await getChain().getTokenMeta();
    tokenMeta = { symbol: meta.symbol, decimals: meta.decimals, source: meta.source };
    chainOk = meta.source === "onchain";
  } catch {
    chainOk = false;
  }

  return json(
    {
      ok: dbOk,
      version: "1.0.0",
      environment: env.nodeEnv,
      database: {
        ok: dbOk,
        engine: integrations.database,
        ...(dbError ? { error: dbError } : {}),
      },
      serverless: env.serverless,
      chain: {
        chainId: 8453,
        mode: env.chainMode,
        rpcConfigured: Boolean(env.baseRpcUrl),
        metadataLive: chainOk,
        token: tokenMeta,
      },
      integrations: {
        telegram: integrations.telegramConfigured,
        x: integrations.xConfigured,
      },
      time: new Date().toISOString(),
    },
    dbOk ? 200 : 503,
  );
});
