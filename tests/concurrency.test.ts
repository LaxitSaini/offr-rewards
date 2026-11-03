import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, query, queryOne } from "@/lib/db";
import { ensureBoot } from "@/lib/bootstrap";
import { provisionAdminFromEnv } from "@/lib/auth/admin";
import { getSettings, saveSettings, type CampaignSettings } from "@/lib/settings";
import { attachReferral, addPoints, getOrCreateUser, getPoints } from "@/lib/users";
import { getTaskBySlug } from "@/lib/services/tasks";
import { newId } from "@/lib/db";
import { now, randomToken } from "@/lib/utils";
import { recordPayout, totalPaidOffr } from "@/lib/services/payouts";
import { reviewSubmission } from "@/lib/services/submissions";
import { ApiError } from "@/lib/http";

/**
 * These tests attack the money paths the way two admins clicking at the same
 * time would: they assert the atomic guards, not just the happy path.
 */

let adminId = "";
let seq = 0;
const wallet = () => `0x${(Date.now() % 1e10).toString(16).padStart(10, "0")}${(++seq).toString(16).padStart(30, "0")}`;

async function pendingSubmission(userId: string, taskSlug: string): Promise<string> {
  const task = await getTaskBySlug(taskSlug);
  if (!task) throw new Error(`missing task ${taskSlug}`);
  const id = newId("sub");
  const ts = now();
  await execute(
    `INSERT INTO submissions (id, user_id, task_id, status, proof_type, proof_url, proof_text, content_hash,
      points_awarded, verification_state, verification_detail, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 'link', NULL, NULL, ?, 0, 'manual', 'test', ?, ?)`,
    [id, userId, task.id, randomToken(16), ts, ts],
  );
  return id;
}

beforeAll(async () => {
  await ensureBoot();
  await provisionAdminFromEnv();
  const admin = await queryOne<{ id: string }>(`SELECT id FROM admins LIMIT 1`);
  if (!admin) throw new Error("bootstrap did not provision an admin");
  adminId = admin.id;
});

describe("double-approval protection", () => {
  it("credits a submission exactly once when two reviewers approve simultaneously", async () => {
    const { user } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    const task = await getTaskBySlug("x-follow");
    const submissionId = await pendingSubmission(user.id, "x-follow");

    const attempts = await Promise.allSettled([
      reviewSubmission({ submissionId, action: "approve", adminId }),
      reviewSubmission({ submissionId, action: "approve", adminId }),
    ]);

    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ApiError);
    expect((reason as ApiError).status).toBe(409);

    const ledger = await query<{ delta: number }>(
      `SELECT delta FROM points_ledger WHERE submission_id = ?`,
      [submissionId],
    );
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0]!.delta)).toBe(task!.points);
    expect(await getPoints(user.id)).toBe(task!.points);
  });

  it("does not reverse points twice when a paid/rejected submission is re-rejected", async () => {
    const { user } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    const task = await getTaskBySlug("x-follow");
    const submissionId = await pendingSubmission(user.id, "x-follow");
    await reviewSubmission({ submissionId, action: "approve", adminId });
    await reviewSubmission({ submissionId, action: "reject", adminId });

    await expect(reviewSubmission({ submissionId, action: "reject", adminId })).rejects.toMatchObject({
      status: 409,
    });
    expect(await getPoints(user.id)).toBe(0);
  });
});

describe("referral credits", () => {
  it("credits the referrer once even when two approvals land together", async () => {
    const settings = await getSettings();
    const { user: referrer } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    const { user: referee } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    const attached = await attachReferral(referee.id, referrer.referral_code);
    expect(attached.ok).toBe(true);

    const first = await pendingSubmission(referee.id, "x-follow");
    const second = await pendingSubmission(referee.id, "meme");

    await Promise.allSettled([
      reviewSubmission({ submissionId: first, action: "approve", adminId }),
      reviewSubmission({ submissionId: second, action: "approve", adminId }),
    ]);

    const credits = await query<{ delta: number }>(
      `SELECT delta FROM points_ledger WHERE user_id = ? AND reason = 'referral_credited'`,
      [referrer.id],
    );
    expect(credits).toHaveLength(1);
    expect(Number(credits[0]!.delta)).toBe(settings.referralPoints);
    const row = await queryOne<{ referral_credited: number }>(
      `SELECT referral_credited FROM users WHERE id = ?`,
      [referee.id],
    );
    expect(Number(row!.referral_credited)).toBe(1);
  });
});

describe("payout limits", () => {
  let original: CampaignSettings;

  beforeAll(async () => {
    original = await getSettings();
    const committed = Number(await totalPaidOffr());
    await saveSettings(
      { ...original, budgetOffr: String(committed + 100), maxRewardPerUserOffr: "100" },
      "test",
    );
  });

  afterAll(async () => {
    await saveSettings(original, "test");
  });

  it("refuses payouts that would exceed the campaign budget, even concurrently", async () => {
    const { user: a } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    const { user: b } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });

    const results = await Promise.allSettled([
      recordPayout({ userId: a.id, amount: "60", adminId }),
      recordPayout({ userId: b.id, amount: "60", adminId }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("refuses a payout above the per-participant cap", async () => {
    const { user } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    await expect(recordPayout({ userId: user.id, amount: "101", adminId })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("keeps failed payouts out of the committed total", async () => {
    const { user } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    const before = await totalPaidOffr();
    const payout = await recordPayout({
      userId: user.id,
      amount: "5",
      txHash: `0x${"9".repeat(64)}`,
      adminId,
    });
    expect(payout.status).toBe("failed");
    expect(await totalPaidOffr()).toBe(before);
  });
});

describe("duplicate pending claims", () => {
  it("rejects a second pending submission for the same wallet and task", async () => {
    const { user } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    await pendingSubmission(user.id, "x-follow");
    await expect(pendingSubmission(user.id, "x-follow")).rejects.toMatchObject({
      message: expect.stringMatching(/unique|duplicate/i),
    });
  });
});

describe("points cap", () => {
  it("clamps an approval to the campaign points cap", async () => {
    const settings = await getSettings();
    const { user } = await getOrCreateUser({ wallet: wallet(), ip: "127.0.0.1" });
    await addPoints({
      userId: user.id,
      delta: settings.maxPointsPerUser - 5,
      reason: "test_seed",
      createdBy: adminId,
    });
    const submissionId = await pendingSubmission(user.id, "x-follow");
    const result = await reviewSubmission({ submissionId, action: "approve", adminId });
    expect(result.pointsAwarded).toBe(5);
    expect(await getPoints(user.id)).toBe(settings.maxPointsPerUser);
  });
});
