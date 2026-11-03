import { query, queryOne } from "@/lib/db";
import { campaignWindow, getSettings, type CampaignSettings } from "@/lib/settings";
import { integrations } from "@/lib/env";
import { OFFR } from "@/lib/constants";
import { shortAddress } from "@/lib/utils";
import { trimDecimal } from "@/lib/format";
import { buildTaskViews, type TaskView } from "@/lib/services/tasks";
import { holdStatusFor, type HoldStatus } from "@/lib/services/holdings";
import { computeReward, budgetSnapshot, type RewardComputation } from "@/lib/services/rewards";
import { paidToUser, totalPaidOffr, userPayouts, type PayoutRow } from "@/lib/services/payouts";
import { listReferrals, type UserRow } from "@/lib/users";

export interface PublicUser {
  id: string;
  wallet: string;
  walletShort: string;
  createdAt: number;
  points: number;
  rank: number | null;
  status: string;
  blocked: boolean;
  xUsername: string | null;
  telegramUsername: string | null;
  telegramLinked: boolean;
  referralCode: string;
  referredBy: boolean;
  riskFlags: string[];
}

export interface SubmissionView {
  id: string;
  taskSlug: string;
  taskTitle: string;
  status: string;
  pointsAwarded: number;
  verificationState: string;
  verificationDetail: string | null;
  proofUrl: string | null;
  proofText: string | null;
  createdAt: number;
  reviewedAt: number | null;
  reviewNote: string | null;
}

export interface DashboardPayload {
  user: PublicUser;
  campaign: {
    name: string;
    startsAt: number;
    endsAt: number;
    live: boolean;
    ended: boolean;
    submissionsOpen: boolean;
    budgetOffr: string;
    offrPerPoint: string;
    minPointsForReward: number;
    maxRewardPerUserOffr: string;
    maxPointsPerUser: number;
    requireHoldForReward: boolean;
    holdMinBalanceOffr: string;
    holdMinDays: number;
    referralPoints: number;
    maxReferralsPerUser: number;
    payoutNote: string;
    termsVersion: string;
  };
  reward: RewardComputation;
  budget: ReturnType<typeof budgetSnapshot>;
  paidOffr: string;
  hold: HoldStatus;
  tasks: TaskView[];
  submissions: SubmissionView[];
  payouts: PayoutRow[];
  referrals: {
    total: number;
    credited: number;
    pointsEarned: number;
    limit: number;
    list: { walletShort: string; createdAt: number; credited: boolean }[];
  };
  verifications: { kind: string; status: string; method: string; detail: string | null; checkedAt: number }[];
  integrations: {
    telegramConfigured: boolean;
    telegramChatId: string | null;
    xConfigured: boolean;
    chainMode: "live" | "mock";
    chainId: number;
    tokenAddress: string;
    explorer: string;
  };
}

export async function getRank(user: UserRow): Promise<number | null> {
  if (user.points_cached <= 0) return null;
  const row = await queryOne<{ rank: number }>(
    `SELECT COUNT(*) + 1 AS rank FROM users WHERE points_cached > ? AND blocked = 0 AND status = 'active'`,
    [user.points_cached],
  );
  return Number(row?.rank ?? 1);
}

export async function getDashboard(user: UserRow): Promise<DashboardPayload> {
  const settings = await getSettings();
  const window = campaignWindow(settings);
  const [hold, paidOffr, userPaid, payouts, rank, referralsRaw, verifications, tasks] =
    await Promise.all([
      holdStatusFor(user, settings),
      totalPaidOffr(),
      paidToUser(user.id),
      userPayouts(user.id),
      getRank(user),
      listReferrals(user.id),
      query<{ kind: string; status: string; method: string; detail: string | null; checked_at: number }>(
        `SELECT kind, status, method, detail, checked_at FROM verifications
         WHERE user_id = ? ORDER BY checked_at DESC LIMIT 12`,
        [user.id],
      ),
      buildTaskViews({ user, settings, campaignLive: window.live }),
    ]);

  const submissionRows = await query<{
    id: string;
    task_id: string;
    task_slug: string;
    task_title: string;
    status: string;
    points_awarded: number;
    verification_state: string;
    verification_detail: string | null;
    proof_url: string | null;
    proof_text: string | null;
    created_at: number;
    reviewed_at: number | null;
    review_note: string | null;
  }>(
    `SELECT s.id, s.task_id, t.slug AS task_slug, t.title AS task_title, s.status, s.points_awarded,
            s.verification_state, s.verification_detail, s.proof_url, s.proof_text, s.created_at,
            s.reviewed_at, s.review_note
     FROM submissions s JOIN tasks t ON t.id = s.task_id
     WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50`,
    [user.id],
  );

  const reward = computeReward({
    points: Number(user.points_cached),
    blocked: Boolean(user.blocked),
    holdRequirementMet: hold.meetsRequirement,
    settings,
    userPaidOffr: userPaid,
    totalPaidOffr: paidOffr,
  });

  const referralPointsRow = await queryOne<{ total: number | null }>(
    `SELECT SUM(delta) AS total FROM points_ledger WHERE user_id = ? AND reason = 'referral_credited'`,
    [user.id],
  );

  return {
    user: {
      id: user.id,
      wallet: user.wallet,
      walletShort: shortAddress(user.wallet, 6),
      createdAt: Number(user.created_at),
      points: Number(user.points_cached),
      rank,
      status: user.status,
      blocked: Boolean(user.blocked),
      xUsername: user.x_username,
      telegramUsername: user.telegram_username,
      telegramLinked: Boolean(user.telegram_linked_at),
      referralCode: user.referral_code,
      referredBy: Boolean(user.referred_by),
      riskFlags: user.risk_flags ? safeFlags(user.risk_flags) : [],
    },
    campaign: {
      name: settings.campaignName,
      startsAt: settings.campaignStartsAt,
      endsAt: settings.campaignEndsAt,
      live: window.live,
      ended: window.ended,
      submissionsOpen: settings.submissionsOpen,
      budgetOffr: settings.budgetOffr,
      offrPerPoint: settings.offrPerPoint,
      minPointsForReward: settings.minPointsForReward,
      maxRewardPerUserOffr: settings.maxRewardPerUserOffr,
      maxPointsPerUser: settings.maxPointsPerUser,
      requireHoldForReward: settings.requireHoldForReward,
      holdMinBalanceOffr: settings.holdMinBalanceOffr,
      holdMinDays: settings.holdMinDays,
      referralPoints: settings.referralPoints,
      maxReferralsPerUser: settings.maxReferralsPerUser,
      payoutNote: settings.payoutNote,
      termsVersion: settings.termsVersion,
    },
    reward,
    budget: budgetSnapshot(settings.budgetOffr, paidOffr),
    paidOffr,
    hold,
    tasks,
    submissions: submissionRows.map((row) => ({
      id: row.id,
      taskSlug: row.task_slug,
      taskTitle: row.task_title,
      status: row.status,
      pointsAwarded: Number(row.points_awarded),
      verificationState: row.verification_state,
      verificationDetail: row.verification_detail,
      proofUrl: row.proof_url,
      proofText: row.proof_text,
      createdAt: Number(row.created_at),
      reviewedAt: row.reviewed_at ? Number(row.reviewed_at) : null,
      reviewNote: row.review_note,
    })),
    payouts,
    referrals: {
      total: referralsRaw.length,
      credited: referralsRaw.filter((r) => r.referral_credited).length,
      pointsEarned: Number(referralPointsRow?.total ?? 0),
      limit: settings.maxReferralsPerUser,
      list: referralsRaw.slice(0, 10).map((r) => ({
        walletShort: shortAddress(r.wallet, 5),
        createdAt: Number(r.created_at),
        credited: Boolean(r.referral_credited),
      })),
    },
    verifications: verifications.map((v) => ({
      kind: v.kind,
      status: v.status,
      method: v.method,
      detail: v.detail,
      checkedAt: Number(v.checked_at),
    })),
    integrations: {
      telegramConfigured: integrations.telegramConfigured,
      telegramChatId: integrations.telegramConfigured ? (process.env.TELEGRAM_CHAT_ID ?? null) : null,
      xConfigured: integrations.xConfigured,
      chainMode: integrations.chainLive ? "live" : "mock",
      chainId: OFFR.chainId,
      tokenAddress: OFFR.tokenAddress,
      explorer: OFFR.explorer,
    },
  };
}

function safeFlags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  xUsername: string | null;
  points: number;
  approvedTasks: number;
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const rows = await query<{
    wallet: string;
    x_username: string | null;
    points_cached: number;
    approved: number;
  }>(
    `SELECT u.wallet, u.x_username, u.points_cached,
            (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id AND s.status IN ('approved','paid')) AS approved
     FROM users u
     WHERE u.blocked = 0 AND u.status = 'active' AND u.points_cached > 0
     ORDER BY u.points_cached DESC, u.created_at ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    wallet: shortAddress(row.wallet, 5),
    xUsername: row.x_username,
    points: Number(row.points_cached),
    approvedTasks: Number(row.approved),
  }));
}

export async function getPublicStats(settings?: CampaignSettings) {
  const s = settings ?? (await getSettings());
  const [participants, points, payouts, tasks] = await Promise.all([
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users`),
    queryOne<{ total: number | null }>(
      `SELECT SUM(delta) AS total FROM points_ledger WHERE reason = 'submission_approved'`,
    ),
    queryOne<{ c: number; total: number | null }>(
      `SELECT COUNT(*) AS c, SUM(CAST(amount AS DECIMAL(30,6))) AS total FROM payouts WHERE status = 'verified'`,
    ),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks WHERE active = 1`),
  ]);
  const window = campaignWindow(s);
  return {
    participants: Number(participants?.c ?? 0),
    pointsAwarded: Number(points?.total ?? 0),
    rewardsPaidOffr: trimDecimal(Number(payouts?.total ?? 0).toFixed(4)),
    verifiedPayouts: Number(payouts?.c ?? 0),
    activeTasks: Number(tasks?.c ?? 0),
    campaignName: s.campaignName,
    startsAt: s.campaignStartsAt,
    endsAt: s.campaignEndsAt,
    live: window.live,
    ended: window.ended,
    budgetOffr: s.budgetOffr,
    integrations: {
      telegram: integrations.telegramConfigured,
      x: integrations.xConfigured,
      chainMode: integrations.chainLive ? "live" : "mock",
    },
  };
}
