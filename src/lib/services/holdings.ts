import { execute, newId, query } from "@/lib/db";
import { getChain, type TokenMeta } from "@/lib/chain";
import { CHAIN_ID, TOKEN_ADDRESS } from "@/lib/constants";
import type { CampaignSettings } from "@/lib/settings";
import { errors } from "@/lib/http";
import { formatUnits } from "viem";
import { formatAmount, HOUR, now, parseAmount } from "@/lib/utils";
import { updateUser, type UserRow } from "@/lib/users";

export interface SnapshotRow {
  id: string;
  user_id: string;
  wallet: string;
  balance_raw: string;
  balance_formatted: string;
  chain_id: number;
  token_address: string;
  block_number: number | null;
  ok: number;
  source: string;
  error: string | null;
  verified_at: number;
}

export interface HoldStatus {
  qualifies: boolean;
  balanceOffr: string;
  minBalanceOffr: string;
  holdDays: number;
  requiredDays: number;
  progressPct: number;
  lastCheckedAt: number | null;
  firstQualifyingAt: number | null;
  meetsRequirement: boolean;
  decimals: number;
  error?: string;
}

/** Counts distinct, well-spaced UTC days with a qualifying snapshot. */
export function countHoldDays(
  snapshots: { balance_raw: string; verified_at: number }[],
  minRaw: bigint,
  minSpacingMs: number,
): number {
  const qualifying = snapshots
    .filter((s) => {
      try {
        return BigInt(s.balance_raw) >= minRaw;
      } catch {
        return false;
      }
    })
    .map((s) => Number(s.verified_at))
    .sort((a, b) => a - b);

  const kept: number[] = [];
  for (const ts of qualifying) {
    if (kept.length === 0 || ts - kept[kept.length - 1] >= minSpacingMs) kept.push(ts);
  }
  const days = new Set(kept.map((ts) => new Date(ts).toISOString().slice(0, 10)));
  return days.size;
}

export async function holdStatusFor(
  user: UserRow,
  settings: CampaignSettings,
): Promise<HoldStatus> {
  const chain = getChain();
  const meta = await chain.getTokenMeta();
  const minRaw = parseAmount(settings.holdMinBalanceOffr, meta.decimals);
  const snapshots = await query<SnapshotRow>(
    `SELECT * FROM holdings_snapshots WHERE user_id = ? AND ok = 1 ORDER BY verified_at ASC`,
    [user.id],
  );
  const holdDays = countHoldDays(snapshots, minRaw, settings.holdSnapshotMinHours * HOUR);
  const latest = snapshots[snapshots.length - 1];
  const balance = latest ? BigInt(latest.balance_raw) : 0n;
  const qualifies = balance >= minRaw;
  const requiredDays = Math.max(1, settings.holdMinDays);
  return {
    qualifies,
    balanceOffr: formatAmount(balance, meta.decimals),
    minBalanceOffr: settings.holdMinBalanceOffr,
    holdDays,
    requiredDays,
    progressPct: Math.min(100, Math.round((holdDays / requiredDays) * 100)),
    lastCheckedAt: latest ? Number(latest.verified_at) : null,
    firstQualifyingAt: user.hold_first_qualifying_at ? Number(user.hold_first_qualifying_at) : null,
    meetsRequirement: qualifies && holdDays >= requiredDays,
    decimals: meta.decimals,
  };
}

export interface VerifyOutcome {
  ok: boolean;
  status: HoldStatus;
  snapshot?: SnapshotRow;
  error?: string;
}

/**
 * Reads the real ERC-20 balance from Base server-side. The client can never
 * supply a balance — it is always derived from the chain.
 */
export async function verifyHoldings(
  user: UserRow,
  settings: CampaignSettings,
  source = "manual",
): Promise<VerifyOutcome> {
  const chain = getChain();
  let meta: TokenMeta;
  let balance: { raw: bigint; blockNumber: bigint | null };
  try {
    meta = await chain.getTokenMeta();
    balance = await chain.getBalance(user.wallet as `0x${string}`);
  } catch (err) {
    const message = (err as Error).message ?? "RPC unavailable";
    await execute(
      `INSERT INTO holdings_snapshots (id, user_id, wallet, balance_raw, balance_formatted, chain_id, token_address, block_number, ok, source, error, verified_at)
       VALUES (?, ?, ?, '0', '0', ?, ?, 0, ?, ?, ?)`,
      [newId("snap"), user.id, user.wallet, CHAIN_ID, TOKEN_ADDRESS, source, message.slice(0, 300), now()],
    );
    throw errors.server(
      "We could not reach the Base RPC to read your balance. Please retry shortly — this is a network issue, not a wallet issue.",
    );
  }

  const minRaw = parseAmount(settings.holdMinBalanceOffr, meta.decimals);
  const qualifies = balance.raw >= minRaw;
  const ts = now();

  const snapshot: SnapshotRow = {
    id: newId("snap"),
    user_id: user.id,
    wallet: user.wallet,
    balance_raw: balance.raw.toString(),
    balance_formatted: formatUnits(balance.raw, meta.decimals),
    chain_id: meta.chainId,
    token_address: meta.address,
    block_number: balance.blockNumber ? Number(balance.blockNumber) : null,
    ok: 1,
    source,
    error: null,
    verified_at: ts,
  };

  await execute(
    `INSERT INTO holdings_snapshots (id, user_id, wallet, balance_raw, balance_formatted, chain_id, token_address, block_number, ok, source, error, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?)`,
    [
      snapshot.id,
      snapshot.user_id,
      snapshot.wallet,
      snapshot.balance_raw,
      snapshot.balance_formatted,
      snapshot.chain_id,
      snapshot.token_address,
      snapshot.block_number,
      snapshot.source,
      snapshot.verified_at,
    ],
  );

  await updateUser(user.id, {
    hold_balance_raw: balance.raw.toString(),
    hold_balance_at: ts,
    ...(qualifies && !user.hold_first_qualifying_at ? { hold_first_qualifying_at: ts } : {}),
  });

  const refreshed = { ...user, hold_balance_raw: balance.raw.toString(), hold_balance_at: ts };
  const status = await holdStatusFor(refreshed, settings);
  await updateUser(user.id, { hold_days: status.holdDays });

  return { ok: true, status, snapshot };
}

export async function listSnapshots(userId: string, limit = 30): Promise<SnapshotRow[]> {
  return query<SnapshotRow>(
    `SELECT * FROM holdings_snapshots WHERE user_id = ? ORDER BY verified_at DESC LIMIT ?`,
    [userId, limit],
  );
}
