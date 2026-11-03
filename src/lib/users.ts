import { execute, newId, query, queryOne } from "@/lib/db";
import { errors } from "@/lib/http";
import { MINUTE, now, randomCode, normalizeWallet } from "@/lib/utils";

export interface UserRow {
  id: string;
  wallet: string;
  wallet_verified_at: number | null;
  signup_ip: string | null;
  created_at: number;
  last_seen_at: number | null;
  referral_code: string;
  referred_by: string | null;
  referral_credited: number;
  x_username: string | null;
  x_user_id: string | null;
  telegram_user_id: string | null;
  telegram_username: string | null;
  telegram_linked_at: number | null;
  hold_balance_raw: string | null;
  hold_balance_at: number | null;
  hold_first_qualifying_at: number | null;
  hold_days: number;
  points_cached: number;
  status: string;
  blocked: number;
  risk_score: number;
  risk_flags: string | null;
  notes: string | null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
}

export async function getUserByWallet(wallet: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT * FROM users WHERE wallet = ?`, [
    normalizeWallet(wallet),
  ]);
}

export async function getUserByReferralCode(code: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT * FROM users WHERE referral_code = ?`, [
    code.trim().toUpperCase(),
  ]);
}

async function generateReferralCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode(6);
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE referral_code = ?`,
      [code],
    );
    if (!existing) return code;
  }
  throw errors.server("Could not allocate a referral code. Try again.");
}

export interface CreateUserInput {
  wallet: string;
  ip?: string | null;
  referralCode?: string | null;
}

export async function getOrCreateUser({
  wallet,
  ip,
  referralCode,
}: CreateUserInput): Promise<{ user: UserRow; created: boolean }> {
  const normalized = normalizeWallet(wallet);
  const existing = await getUserByWallet(normalized);
  if (existing) {
    await execute(`UPDATE users SET last_seen_at = ? WHERE id = ?`, [now(), existing.id]);
    return { user: { ...existing, last_seen_at: now() }, created: false };
  }

  const ts = now();
  const id = newId("usr");
  const code = await generateReferralCode();

  // Referral binding is resolved before insert so the first wallet write wins.
  let referredBy: string | null = null;
  if (referralCode) {
    const referrer = await getUserByReferralCode(referralCode);
    if (referrer && referrer.wallet !== normalized && !referrer.blocked) {
      referredBy = referrer.id;
    }
  }

  await execute(
    `INSERT INTO users (id, wallet, wallet_verified_at, signup_ip, created_at, last_seen_at,
      referral_code, referred_by, referral_credited, points_cached, status, blocked, risk_score, hold_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', 0, 0, 0)`,
    [id, normalized, ts, ip ?? null, ts, ts, code, referredBy],
  );

  const user = await getUserById(id);
  if (!user) throw errors.server("Failed to create participant record.");
  return { user, created: true };
}

const UPDATABLE = new Set([
  "wallet_verified_at",
  "x_username",
  "x_user_id",
  "telegram_user_id",
  "telegram_username",
  "telegram_linked_at",
  "hold_balance_raw",
  "hold_balance_at",
  "hold_first_qualifying_at",
  "hold_days",
  "status",
  "blocked",
  "risk_score",
  "risk_flags",
  "notes",
  "referred_by",
  "referral_credited",
  "points_cached",
]);

export async function updateUser(
  userId: string,
  patch: Partial<Record<keyof UserRow, string | number | null>>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => UPDATABLE.has(key));
  if (entries.length === 0) return;
  const assigns = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => (value === undefined ? null : value));
  await execute(`UPDATE users SET ${assigns} WHERE id = ?`, [...values, userId]);
}

/** Applies a referral code to an existing participant. */
export async function attachReferral(
  userId: string,
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  const user = await getUserById(userId);
  if (!user) throw errors.notFound("Participant not found.");
  if (user.referred_by) return { ok: false, reason: "A referral is already linked to this wallet." };

  const referrer = await getUserByReferralCode(code);
  if (!referrer) return { ok: false, reason: "That referral code does not exist." };
  if (referrer.id === user.id) return { ok: false, reason: "You cannot refer your own wallet." };
  if (referrer.blocked) return { ok: false, reason: "That referral code is not active." };

  // Only fresh wallets can be referred: prevents retroactive farming.
  const ageMs = now() - user.created_at;
  if (ageMs > 24 * 60 * MINUTE) {
    return { ok: false, reason: "Referral codes can only be linked within 24 hours of joining." };
  }

  const existing = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users WHERE referred_by = ?`,
    [referrer.id],
  );
  const { getSettings } = await import("@/lib/settings");
  const settings = await getSettings();
  if (Number(existing?.c ?? 0) >= settings.maxReferralsPerUser) {
    return { ok: false, reason: "This referral link has reached its wallet limit." };
  }

  await updateUser(userId, { referred_by: referrer.id });
  return { ok: true };
}

export async function addPoints(input: {
  userId: string;
  delta: number;
  reason: string;
  submissionId?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.delta) || input.delta === 0) return;
  await execute(
    `INSERT INTO points_ledger (id, user_id, submission_id, delta, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("plg"),
      input.userId,
      input.submissionId ?? null,
      Math.round(input.delta),
      input.reason,
      now(),
      input.createdBy ?? null,
    ],
  );
  await recomputePoints(input.userId);
}

export async function recomputePoints(userId: string): Promise<number> {
  const row = await queryOne<{ total: number | null }>(
    `SELECT SUM(delta) AS total FROM points_ledger WHERE user_id = ?`,
    [userId],
  );
  const total = Number(row?.total ?? 0);
  await execute(`UPDATE users SET points_cached = ? WHERE id = ?`, [total, userId]);
  return total;
}

export async function getPoints(userId: string): Promise<number> {
  const row = await queryOne<{ total: number | null }>(
    `SELECT SUM(delta) AS total FROM points_ledger WHERE user_id = ?`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

export async function listReferrals(userId: string) {
  return query<{
    id: string;
    wallet: string;
    created_at: number;
    referral_credited: number;
    points_cached: number;
  }>(
    `SELECT id, wallet, created_at, referral_credited, points_cached
     FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
}

export function isBlocked(user: UserRow): boolean {
  return Boolean(user.blocked) || user.status === "blocked";
}

/** Flags suspicious patterns for manual review instead of auto-banning. */
export async function evaluateRisk(user: UserRow, ip?: string | null): Promise<string[]> {
  const flags: string[] = [];
  if (ip && ip !== "unknown" && ip !== "direct") {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM users WHERE signup_ip = ? AND id <> ?`,
      [ip, user.id],
    );
    if (Number(row?.c ?? 0) >= 3) flags.push("multiple_wallets_same_ip");
  }
  if (user.referred_by) {
    const referrer = await getUserById(user.referred_by);
    if (referrer && referrer.signup_ip && referrer.signup_ip === user.signup_ip) {
      flags.push("referrer_same_ip");
    }
  }
  return flags;
}
