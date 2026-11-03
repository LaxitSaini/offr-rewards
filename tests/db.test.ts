import { beforeAll, describe, expect, it } from "vitest";
import { execute, query, queryOne } from "@/lib/db";
import { ensureBoot } from "@/lib/bootstrap";
import { getSettings } from "@/lib/settings";
import { addPoints, attachReferral, getPoints, getOrCreateUser } from "@/lib/users";
import { getTaskBySlug, taskStateFromSubmissions, type SubmissionLite } from "@/lib/services/tasks";
import { reviewSubmission } from "@/lib/services/submissions";

let counter = 0;
const wallet = () => `0x${(++counter).toString(16).padStart(40, "0")}`;

beforeAll(async () => {
  await ensureBoot();
});

describe("database bootstrap", () => {
  it("creates the schema and seeds the campaign catalogue", async () => {
    const tasks = await query<{ slug: string }>(`SELECT slug FROM tasks ORDER BY sort_order`);
    expect(tasks.length).toBeGreaterThanOrEqual(6);
    expect(tasks.map((t) => t.slug)).toContain("telegram-join");
    expect(tasks.map((t) => t.slug)).toContain("offr-holder");
  });

  it("is idempotent — re-running the bootstrap does not duplicate tasks or settings", async () => {
    const before = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks`);
    await ensureBoot();
    const after = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks`);
    expect(after?.c).toBe(before?.c);
    const settings = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM settings`);
    expect(settings?.c).toBe(1);
  });

  it("loads default campaign settings with a valid window", async () => {
    const settings = await getSettings();
    expect(Number(settings.budgetOffr)).toBeGreaterThan(0);
    expect(settings.campaignEndsAt).toBeGreaterThan(settings.campaignStartsAt);
    expect(settings.maxPointsPerUser).toBeGreaterThan(0);
  });
});

describe("participants", () => {
  it("creates one record per wallet and lowercases addresses", async () => {
    const address = wallet().toUpperCase().replace("0X", "0x");
    const first = await getOrCreateUser({ wallet: address });
    const second = await getOrCreateUser({ wallet: address.toLowerCase() });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(first.user.wallet).toBe(address.toLowerCase());
    expect(first.user.referral_code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("links referrals once and blocks self-referral", async () => {
    const referrer = await getOrCreateUser({ wallet: wallet() });
    const referee = await getOrCreateUser({ wallet: wallet() });

    const self = await attachReferral(referrer.user.id, referrer.user.referral_code);
    expect(self.ok).toBe(false);

    const ok = await attachReferral(referee.user.id, referrer.user.referral_code);
    expect(ok.ok).toBe(true);

    const again = await attachReferral(referee.user.id, referrer.user.referral_code);
    expect(again.ok).toBe(false);

    const fresh = await queryOne<{ referred_by: string }>(`SELECT referred_by FROM users WHERE id = ?`, [
      referee.user.id,
    ]);
    expect(fresh?.referred_by).toBe(referrer.user.id);
  });

  it("keeps a points ledger and rebuilds the cached total", async () => {
    const user = await getOrCreateUser({ wallet: wallet() });
    await addPoints({ userId: user.user.id, delta: 120, reason: "manual_adjustment" });
    await addPoints({ userId: user.user.id, delta: 30, reason: "manual_adjustment" });
    await addPoints({ userId: user.user.id, delta: -20, reason: "manual_adjustment" });
    expect(await getPoints(user.user.id)).toBe(130);
    const cached = await queryOne<{ points_cached: number }>(
      `SELECT points_cached FROM users WHERE id = ?`,
      [user.user.id],
    );
    expect(Number(cached?.points_cached)).toBe(130);
  });

  it("enforces one Telegram account per wallet", async () => {
    const a = await getOrCreateUser({ wallet: wallet() });
    const b = await getOrCreateUser({ wallet: wallet() });
    await execute(`UPDATE users SET telegram_user_id = ? WHERE id = ?`, ["999001", a.user.id]);
    await expect(
      execute(`UPDATE users SET telegram_user_id = ? WHERE id = ?`, ["999001", b.user.id]),
    ).rejects.toThrow();
  });
});

describe("submission review flow", () => {
  it("approves a pending submission, credits points and the referrer", async () => {
    const referrer = await getOrCreateUser({ wallet: wallet() });
    const referee = await getOrCreateUser({ wallet: wallet(), referralCode: referrer.user.referral_code });
    const task = await getTaskBySlug("x-follow");
    expect(task).not.toBeNull();

    const hash = `test:${Date.now()}:${Math.random()}`;
    await execute(
      `INSERT INTO submissions (id, user_id, task_id, status, proof_type, proof_text, content_hash,
        points_awarded, verification_state, verification_detail, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 'x_handle', '@tester', ?, 0, 'manual', 'queued', ?, ?)`,
      [`sub_${hash}`, referee.user.id, task!.id, hash, Date.now(), Date.now()],
    );

    const result = await reviewSubmission({
      submissionId: `sub_${hash}`,
      adminId: "adm_test",
      action: "approve",
      note: "looks good",
    });

    expect(result.pointsAwarded).toBe(task!.points);
    expect(result.submission.status).toBe("approved");
    expect(await getPoints(referee.user.id)).toBe(task!.points);
    expect(result.referralCredited).toBe(true);
    expect(await getPoints(referrer.user.id)).toBeGreaterThan(0);

    const referralRow = await queryOne<{ referral_credited: number }>(
      `SELECT referral_credited FROM users WHERE id = ?`,
      [referee.user.id],
    );
    expect(Number(referralRow?.referral_credited)).toBe(1);

    const audit = await query<{ action: string }>(
      `SELECT action FROM audit_log WHERE target_id = ? ORDER BY created_at DESC`,
      [`sub_${hash}`],
    );
    expect(audit.some((a) => a.action === "submission.approve")).toBe(true);
  });

  it("refuses to approve the same submission twice", async () => {
    const user = await getOrCreateUser({ wallet: wallet() });
    const task = await getTaskBySlug("meme");
    const id = `sub_dup_${Date.now()}`;
    await execute(
      `INSERT INTO submissions (id, user_id, task_id, status, content_hash, points_awarded, verification_state,
        created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, 'manual', ?, ?)`,
      [id, user.user.id, task!.id, `dup:${id}`, Date.now(), Date.now()],
    );
    await reviewSubmission({ submissionId: id, adminId: "adm_test", action: "approve" });
    await expect(
      reviewSubmission({ submissionId: id, adminId: "adm_test", action: "approve" }),
    ).rejects.toThrow();
  });

  it("revokes points when an approval is rejected", async () => {
    const user = await getOrCreateUser({ wallet: wallet() });
    const task = await getTaskBySlug("content");
    const id = `sub_rev_${Date.now()}`;
    await execute(
      `INSERT INTO submissions (id, user_id, task_id, status, content_hash, points_awarded, verification_state,
        created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, 'manual', ?, ?)`,
      [id, user.user.id, task!.id, `rev:${id}`, Date.now(), Date.now()],
    );
    await reviewSubmission({ submissionId: id, adminId: "adm_test", action: "approve" });
    const before = await getPoints(user.user.id);
    expect(before).toBeGreaterThan(0);

    await reviewSubmission({ submissionId: id, adminId: "adm_test", action: "reject", note: "low effort" });
    expect(await getPoints(user.user.id)).toBe(0);

    const row = await queryOne<{ status: string; points_awarded: number }>(
      `SELECT status, points_awarded FROM submissions WHERE id = ?`,
      [id],
    );
    expect(row?.status).toBe("rejected");
    expect(Number(row?.points_awarded)).toBe(0);
  });

  it("prevents duplicate proof content across wallets", async () => {
    const a = await getOrCreateUser({ wallet: wallet() });
    const b = await getOrCreateUser({ wallet: wallet() });
    const task = await getTaskBySlug("x-post");
    const hash = `xpost:${Date.now()}`;
    await execute(
      `INSERT INTO submissions (id, user_id, task_id, status, content_hash, points_awarded, verification_state,
        created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, 'manual', ?, ?)`,
      [`sub_a_${hash}`, a.user.id, task!.id, hash, Date.now(), Date.now()],
    );
    await expect(
      execute(
        `INSERT INTO submissions (id, user_id, task_id, status, content_hash, points_awarded, verification_state,
          created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, 'manual', ?, ?)`,
        [`sub_b_${hash}`, b.user.id, task!.id, hash, Date.now(), Date.now()],
      ),
    ).rejects.toThrow();
  });
});

describe("task state machine", () => {
  const task = {
    id: "t1",
    slug: "x-post",
    title: "Post",
    description: "",
    instructions: "",
    type: "x_post",
    points: 300,
    max_awards: 2,
    requires_proof: 1,
    requires_holding_raw: null,
    min_hold_days: 0,
    auto_verify: "none",
    active: 1,
    sort_order: 10,
    created_at: 0,
    updated_at: 0,
  };

  const submission = (status: string, id = "s1"): SubmissionLite => ({
    id,
    task_id: "t1",
    status,
    points_awarded: status === "approved" ? 300 : 0,
    verification_state: "manual",
    verification_detail: null,
    proof_url: null,
    proof_text: null,
    created_at: 1,
    reviewed_at: null,
    review_note: null,
  });

  it("is available with no submissions", () => {
    expect(taskStateFromSubmissions(task, []).status).toBe("available");
  });

  it("is pending while a submission awaits review", () => {
    expect(taskStateFromSubmissions(task, [submission("pending")]).status).toBe("pending");
  });

  it("shows rejected so the user can resubmit", () => {
    expect(taskStateFromSubmissions(task, [submission("rejected")]).status).toBe("rejected");
  });

  it("completes once max awards are approved", () => {
    const rows = [submission("approved", "s1"), submission("approved", "s2")];
    const state = taskStateFromSubmissions(task, rows);
    expect(state.status).toBe("completed");
    expect(state.approvedCount).toBe(2);
  });

  it("stays available when only one of two awards is approved", () => {
    expect(taskStateFromSubmissions(task, [submission("approved")]).status).toBe("approved");
  });
});
