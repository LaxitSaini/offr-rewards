import { queryOne } from "@/lib/db";
import { integrations, env } from "@/lib/env";
import { getChain } from "@/lib/chain";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Liveness + configuration probe. Never returns secrets. */
export const GET = route(async () => {
  let dbOk = false;
  try {
    const row = await queryOne<{ ok: number }>(`SELECT 1 AS ok`);
    dbOk = Number(row?.ok ?? 0) === 1;
  } catch (err) {
    console.error("[health] database check failed:", (err as Error).message);
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
      database: { ok: dbOk, engine: integrations.database },
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
