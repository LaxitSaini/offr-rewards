import { execute, newId, query, queryOne } from "@/lib/db";
import { getChain, ERC20_TRANSFER_TOPIC } from "@/lib/chain";
import { CHAIN_ID, TOKEN_ADDRESS } from "@/lib/constants";
import { env } from "@/lib/env";
import { ApiError, errors } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { decimalCmp, subDecimal, addDecimal } from "@/lib/services/rewards";
import { holdStatusFor } from "@/lib/services/holdings";
import { getUserById, isBlocked, type UserRow } from "@/lib/users";
import { isTxHash, now, parseAmount, truncate } from "@/lib/utils";
import { trimDecimal } from "@/lib/format";

export interface PayoutRow {
  id: string;
  user_id: string;
  amount: string;
  amount_raw: string;
  tx_hash: string | null;
  status: "recorded" | "verified" | "failed" | "void";
  chain_id: number;
  note: string | null;
  verification_detail: string | null;
  verified_at: number | null;
  created_by: string | null;
  created_at: number;
}

export async function totalPaidOffr(): Promise<string> {
  const row = await queryOne<{ total: string | null }>(
    `SELECT SUM(CAST(amount AS DECIMAL(30,6))) AS total FROM payouts WHERE status IN ('recorded','verified')`,
  );
  const value = Number(row?.total ?? 0);
  return Number.isFinite(value) && value > 0 ? trimDecimal(value.toFixed(6)) : "0";
}

export async function paidToUser(userId: string): Promise<string> {
  const row = await queryOne<{ total: string | null }>(
    `SELECT SUM(CAST(amount AS DECIMAL(30,6))) AS total FROM payouts
     WHERE user_id = ? AND status IN ('recorded','verified')`,
    [userId],
  );
  const value = Number(row?.total ?? 0);
  return Number.isFinite(value) && value > 0 ? trimDecimal(value.toFixed(6)) : "0";
}

export interface VerifyPayoutResult {
  status: "verified" | "failed";
  detail: string;
  blockNumber?: number;
}

/**
 * Confirms a Base transaction actually transfers the OFFR token to the
 * participant. A payout is never marked paid just because a hash was typed in.
 */
export async function verifyPayoutTx(args: {
  txHash: string;
  wallet: string;
  amountRaw: bigint;
  amount: string;
}): Promise<VerifyPayoutResult> {
  if (!isTxHash(args.txHash)) {
    return { status: "failed", detail: "Transaction hash is not a valid 32-byte Base hash." };
  }
  const chain = getChain();
  const receipt = await chain.getTransactionReceipt(args.txHash as `0x${string}`);
  if (!receipt) {
    return {
      status: "failed",
      detail: "Transaction was not found on Base yet. It may still be pending — re-verify in a minute.",
    };
  }
  if (receipt.status !== "success") {
    return { status: "failed", detail: "Transaction reverted on Base." };
  }

  const walletPadded = `0x${args.wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const expectedFrom = env.teamWallet
    ? `0x${env.teamWallet.replace(/^0x/, "").padStart(64, "0")}`
    : null;
  let received = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    if (!log.topics[2] || log.topics[2].toLowerCase() !== walletPadded) continue;
    // When TEAM_WALLET_ADDRESS is configured, only transfers from the official
    // payout wallet are accepted.
    if (expectedFrom && (!log.topics[1] || log.topics[1].toLowerCase() !== expectedFrom)) continue;
    try {
      received += BigInt(log.data);
    } catch {
      /* ignore malformed log */
    }
  }

  if (received === 0n) {
    return {
      status: "failed",
      detail: "No OFFR transfer to this wallet was found in that transaction.",
    };
  }
  if (received < args.amountRaw) {
    return {
      status: "failed",
      detail: `Transaction transferred less than the recorded amount (${received.toString()} raw vs ${args.amountRaw.toString()} raw).`,
    };
  }

  return {
    status: "verified",
    detail: `Verified on Base${receipt.blockNumber ? ` at block ${receipt.blockNumber}` : ""}: ${args.amount} OFFR received.`,
    blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : undefined,
  };
}

export interface RecordPayoutInput {
  userId: string;
  amount: string;
  txHash?: string | null;
  note?: string | null;
  adminId: string;
  ip?: string | null;
  /** Explicit, audited override of the campaign holding requirement. */
  overrideHoldRequirement?: boolean;
}

export async function recordPayout(input: RecordPayoutInput): Promise<PayoutRow> {
  const settings = await getSettings();
  const user = await getUserById(input.userId);
  if (!user) throw errors.notFound("Participant not found.");
  if (isBlocked(user)) throw errors.forbidden("Blocked participants cannot receive payouts.");

  const amount = input.amount.trim();
  if (!/^\d+(\.\d+)?$/.test(amount) || decimalCmp(amount, "0") <= 0) {
    throw errors.badRequest("Enter a positive OFFR amount.");
  }

  const alreadyPaid = await paidToUser(user.id);
  if (decimalCmp(addDecimal(alreadyPaid, amount), settings.maxRewardPerUserOffr) > 0) {
    throw errors.badRequest(
      `This payout would exceed the per-participant cap of ${settings.maxRewardPerUserOffr} OFFR (already paid: ${alreadyPaid}).`,
    );
  }

  const paidTotal = await totalPaidOffr();
  if (decimalCmp(addDecimal(paidTotal, amount), settings.budgetOffr) > 0) {
    throw errors.badRequest(
      `This payout would exceed the campaign budget of ${settings.budgetOffr} OFFR (already committed: ${paidTotal}).`,
    );
  }

  const txHash = input.txHash?.trim() || null;
  if (txHash && !isTxHash(txHash)) {
    throw errors.badRequest("That is not a valid Base transaction hash (0x + 64 hex characters).");
  }

  // Token decimals must come from the chain. Assuming 18 could mis-scale the
  // recorded amount (and therefore what a transaction is allowed to prove), so
  // this fails closed instead of guessing.
  const chain = getChain();
  let meta: { decimals: number; source: string };
  try {
    meta = await chain.getTokenMeta();
  } catch {
    if (env.chainMode === "live") {
      throw new ApiError(
        503,
        "chain_unavailable",
        "Could not read the OFFR token metadata from Base, so a payout cannot be recorded safely. Retry when the RPC is reachable.",
      );
    }
    meta = { decimals: env.tokenDecimalsOverride ?? 18, source: "fallback" };
  }

  if (
    txHash &&
    env.chainMode !== "mock" &&
    meta.source !== "onchain" &&
    env.tokenDecimalsOverride === undefined
  ) {
    throw new ApiError(
      503,
      "chain_unavailable",
      "Token decimals could not be read from Base, so a transaction hash cannot be verified. Record the payout without a hash and verify later.",
    );
  }

  let amountRaw = 0n;
  try {
    amountRaw = parseAmount(amount, meta.decimals);
  } catch {
    throw errors.badRequest("Amount has too many decimal places for this token.");
  }

  // Campaign-level holding gate (configurable). An explicit override is allowed
  // but recorded in the audit log.
  if (settings.requireHoldForReward && !input.overrideHoldRequirement) {
    const hold = await holdStatusFor(user, settings);
    if (!hold.meetsRequirement) {
      throw errors.badRequest(
        `This campaign requires a verified OFFR holding before payout (${hold.holdDays}/${hold.requiredDays} days, balance ${hold.balanceOffr}). Use the override only with documented approval.`,
      );
    }
  }

  let status: PayoutRow["status"] = "recorded";
  let detail: string | null = txHash
    ? "Recorded — on-chain verification pending."
    : "Recorded without a transaction hash. Add the hash once sent.";
  let verifiedAt: number | null = null;

  if (txHash) {
    const check = await verifyPayoutTx({ txHash, wallet: user.wallet, amountRaw, amount });
    status = check.status;
    detail = check.detail;
    if (check.status === "verified") verifiedAt = now();
  }

  const id = newId("pay");
  try {
    // Single-statement atomic gate: the row is only inserted if the campaign
    // budget and the per-participant cap still hold at insert time. Two admins
    // paying simultaneously cannot overspend the budget.
    const inserted = await execute(
      `INSERT INTO payouts (id, user_id, amount, amount_raw, tx_hash, status, chain_id, note,
        verification_detail, verified_at, created_by, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COALESCE(SUM(CAST(amount AS DECIMAL(30,6))), 0) FROM payouts
                WHERE status IN ('recorded','verified'))
             + CAST(? AS DECIMAL(30,6)) <= CAST(? AS DECIMAL(30,6))
         AND (SELECT COALESCE(SUM(CAST(amount AS DECIMAL(30,6))), 0) FROM payouts
                WHERE user_id = ? AND status IN ('recorded','verified'))
             + CAST(? AS DECIMAL(30,6)) <= CAST(? AS DECIMAL(30,6))`,
      [
        id,
        user.id,
        amount,
        amountRaw.toString(),
        txHash,
        status,
        CHAIN_ID,
        truncate(input.note ?? "", 500) || null,
        detail,
        verifiedAt,
        input.adminId,
        now(),
        amount,
        settings.budgetOffr,
        user.id,
        amount,
        settings.maxRewardPerUserOffr,
      ],
    );

    if (inserted.changes !== 1) {
      const [total, userTotal] = await Promise.all([totalPaidOffr(), paidToUser(user.id)]);
      const wouldBeTotal = addDecimal(total, amount);
      if (decimalCmp(wouldBeTotal, settings.budgetOffr) > 0) {
        throw errors.badRequest(
          `This payout would exceed the campaign budget of ${settings.budgetOffr} OFFR (already committed: ${total}, this payout would make ${wouldBeTotal}).`,
        );
      }
      throw errors.badRequest(
        `This payout would exceed the per-participant cap of ${settings.maxRewardPerUserOffr} OFFR (already paid: ${userTotal}).`,
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (/unique|duplicate/i.test((err as Error).message ?? "")) {
      throw errors.conflict("That transaction hash has already been recorded.");
    }
    throw err;
  }

  if (status === "verified") {
    await markSubmissionsPaid(user.id, input.adminId);
  }

  await recordAudit({
    actorType: "admin",
    actorId: input.adminId,
    action: "payout.recorded",
    targetType: "payout",
    targetId: id,
    meta: {
      user: user.wallet,
      amount,
      txHash,
      status,
      holdOverride: input.overrideHoldRequirement ? true : undefined,
    },
    ip: input.ip ?? null,
  });

  const row = await queryOne<PayoutRow>(`SELECT * FROM payouts WHERE id = ?`, [id]);
  return row!;
}

export async function revalidatePayout(payoutId: string, adminId: string): Promise<PayoutRow> {
  const payout = await queryOne<PayoutRow>(`SELECT * FROM payouts WHERE id = ?`, [payoutId]);
  if (!payout) throw errors.notFound("Payout not found.");
  if (!payout.tx_hash) throw errors.badRequest("This payout has no transaction hash to verify.");
  if (payout.status === "void") throw errors.badRequest("Voided payouts cannot be re-verified.");

  const user = await getUserById(payout.user_id);
  if (!user) throw errors.notFound("Participant not found.");

  const check = await verifyPayoutTx({
    txHash: payout.tx_hash,
    wallet: user.wallet,
    amountRaw: BigInt(payout.amount_raw),
    amount: payout.amount,
  });

  await execute(
    `UPDATE payouts SET status = ?, verification_detail = ?, verified_at = ? WHERE id = ?`,
    [check.status, check.detail, check.status === "verified" ? now() : null, payout.id],
  );

  if (check.status === "verified") await markSubmissionsPaid(user.id, adminId);

  await recordAudit({
    actorType: "admin",
    actorId: adminId,
    action: "payout.reverified",
    targetType: "payout",
    targetId: payout.id,
    meta: { status: check.status, detail: check.detail },
  });

  return (await queryOne<PayoutRow>(`SELECT * FROM payouts WHERE id = ?`, [payout.id]))!;
}

export async function voidPayout(payoutId: string, adminId: string, reason: string): Promise<void> {
  const payout = await queryOne<PayoutRow>(`SELECT * FROM payouts WHERE id = ?`, [payoutId]);
  if (!payout) throw errors.notFound("Payout not found.");
  if (payout.status === "verified") {
    throw errors.conflict("Verified on-chain payouts cannot be voided. Record a correction instead.");
  }
  await execute(`UPDATE payouts SET status = 'void', note = ? WHERE id = ?`, [
    truncate(reason, 300),
    payoutId,
  ]);
  await recordAudit({
    actorType: "admin",
    actorId: adminId,
    action: "payout.voided",
    targetType: "payout",
    targetId: payoutId,
    meta: { reason },
  });
}

async function markSubmissionsPaid(userId: string, adminId: string): Promise<void> {
  const res = await execute(
    `UPDATE submissions SET status = 'paid', updated_at = ? WHERE user_id = ? AND status = 'approved'`,
    [now(), userId],
  );
  if (res.changes > 0) {
    await recordAudit({
      actorType: "admin",
      actorId: adminId,
      action: "submissions.marked_paid",
      targetType: "user",
      targetId: userId,
      meta: { count: res.changes },
    });
  }
}

export async function listPayouts(filters: { limit?: number; offset?: number; status?: string } = {}) {
  const params: (string | number)[] = [];
  let where = "";
  if (filters.status && filters.status !== "all") {
    where = `WHERE p.status = ?`;
    params.push(filters.status);
  }
  return query(
    `SELECT p.*, u.wallet, u.x_username
     FROM payouts p JOIN users u ON u.id = p.user_id
     ${where}
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 50, filters.offset ?? 0],
  );
}

export async function userPayouts(userId: string, limit = 25): Promise<PayoutRow[]> {
  return query<PayoutRow>(
    `SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function payoutStats() {
  const row = await queryOne<{ verified_count: number; total: string | null }>(
    `SELECT COUNT(*) AS verified_count, SUM(CASE WHEN status IN ('recorded','verified') THEN CAST(amount AS DECIMAL(30,6)) ELSE 0 END) AS total
     FROM payouts`,
  );
  return {
    count: Number(row?.verified_count ?? 0),
    totalOffr: trimDecimal(Number(row?.total ?? 0).toFixed(6)),
  };
}

export function remainingBudget(settingsBudget: string, paid: string): string {
  return subDecimal(settingsBudget, paid);
}

export function assertPayoutUser(user: UserRow): void {
  if (isBlocked(user)) throw errors.forbidden("Blocked participants cannot receive payouts.");
}
