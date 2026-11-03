import { execute, newId, query, queryOne } from "@/lib/db";
import { errors } from "@/lib/http";
import { integrations } from "@/lib/env";
import { getSettings, type CampaignSettings, campaignWindow } from "@/lib/settings";
import type { UserRow } from "@/lib/users";
import { addPoints, getPoints, getUserById, isBlocked, updateUser } from "@/lib/users";
import { recordAudit } from "@/lib/audit";
import { getTaskBySlug, type TaskRow } from "@/lib/services/tasks";
import { verifyXPost } from "@/lib/integrations/x";
import { canonicalProofUrl, extractTweetId, now, sha256, truncate } from "@/lib/utils";
import { rateLimit } from "@/lib/ratelimit";

export interface SubmissionRow {
  id: string;
  user_id: string;
  task_id: string;
  status: "pending" | "approved" | "rejected" | "paid";
  proof_type: string | null;
  proof_url: string | null;
  proof_text: string | null;
  content_hash: string | null;
  points_awarded: number;
  verification_state: "unverified" | "verified" | "failed" | "manual";
  verification_detail: string | null;
  created_at: number;
  updated_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  review_note: string | null;
}

const X_HANDLE_RE = /^@?[A-Za-z0-9_]{2,15}$/;

export function normalizeXHandle(raw: string): string {
  const handle = raw.trim().replace(/^@/, "");
  if (!X_HANDLE_RE.test(handle)) {
    throw errors.badRequest("Enter a valid X username (letters, numbers and underscore, max 15 characters).");
  }
  return handle;
}

export interface SubmitInput {
  user: UserRow;
  taskSlug: string;
  proofUrl?: string | null;
  proofText?: string | null;
  ip: string;
  settings?: CampaignSettings;
}

export async function submitTask(input: SubmitInput): Promise<SubmissionRow> {
  const settings = input.settings ?? (await getSettings());
  const { user } = input;

  if (isBlocked(user)) throw errors.forbidden("This wallet is restricted from submissions.");
  if (!settings.submissionsOpen) throw errors.forbidden("Submissions are currently closed.");
  const window = campaignWindow(settings);
  if (!window.live) throw errors.forbidden("The campaign is not accepting submissions right now.");

  const task = await getTaskBySlug(input.taskSlug);
  if (!task || !task.active) throw errors.notFound("That task is not part of the campaign.");

  if (task.auto_verify === "telegram" && integrations.telegramConfigured) {
    throw errors.badRequest("Join Telegram with the Connect Telegram button — it is verified automatically.");
  }
  if (task.auto_verify === "onchain_hold") {
    throw errors.badRequest("This task is verified on-chain. Use Verify holdings to run a balance check.");
  }

  const rl = await rateLimit(`submit:${user.id}`, 12, 60 * 60 * 1000);
  if (!rl.ok) throw errors.tooMany(rl.retryAfterSec, "Too many submissions. Try again later.");
  const rlIp = await rateLimit(`submit-ip:${input.ip}`, 40, 60 * 60 * 1000);
  if (!rlIp.ok) throw errors.tooMany(rlIp.retryAfterSec, "Too many submissions from this network.");

  const existing = await query<SubmissionRow>(
    `SELECT * FROM submissions WHERE user_id = ? AND task_id = ?`,
    [user.id, task.id],
  );
  if (existing.some((s) => s.status === "pending")) {
    throw errors.conflict("You already have a submission awaiting review for this task.");
  }
  const approvedCount = existing.filter((s) => s.status === "approved" || s.status === "paid").length;
  if (approvedCount >= task.max_awards) {
    throw errors.conflict("You have already completed this task the maximum number of times.");
  }

  let proofUrl: string | null = null;
  let proofText: string | null = null;
  let contentHash: string;
  let verificationState: SubmissionRow["verification_state"] = "unverified";
  let verificationDetail: string | null = null;
  let proofType = "text";
  let xHandleUpdate: string | null = null;

  if (task.type === "x_follow") {
    if (!input.proofText) throw errors.badRequest("Enter your X username so we can verify the follow.");
    const handle = normalizeXHandle(input.proofText);
    proofText = `@${handle}`;
    proofType = "x_handle";
    contentHash = sha256(`xhandle:${handle.toLowerCase()}`);
    xHandleUpdate = handle;

    const clash = await queryOne<{ wallet: string }>(
      `SELECT u.wallet FROM submissions s JOIN users u ON u.id = s.user_id
       WHERE s.task_id = ? AND s.content_hash = ? AND u.id <> ? LIMIT 1`,
      [task.id, contentHash, user.id],
    );
    if (clash) {
      throw errors.conflict("That X handle is already linked to another wallet.");
    }
    verificationState = "manual";
    verificationDetail =
      "Follow is confirmed by the team on X. The X API follow check requires user-context OAuth, which is not enabled for this campaign.";
  } else if (task.type === "telegram") {
    // Manual fallback used when the Bot API is not configured for this deployment.
    if (!input.proofText) throw errors.badRequest("Enter your Telegram @username.");
    const handle = input.proofText.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{4,32}$/.test(handle)) {
      throw errors.badRequest("Enter a valid Telegram username (4–32 letters, numbers or underscores).");
    }
    proofText = `@${handle}`;
    proofType = "telegram_handle";
    contentHash = sha256(`telegram:${handle.toLowerCase()}`);
    const clash = await queryOne<{ wallet: string }>(
      `SELECT u.wallet FROM submissions s JOIN users u ON u.id = s.user_id
       WHERE s.task_id = ? AND s.content_hash = ? AND u.id <> ? LIMIT 1`,
      [task.id, contentHash, user.id],
    );
    if (clash) throw errors.conflict("That Telegram account is already linked to another wallet.");
    verificationState = "manual";
    verificationDetail =
      "Telegram Bot API is not configured on this deployment. Queued for manual membership review.";
  } else if (task.type === "x_post") {
    if (!input.proofUrl) throw errors.badRequest("Paste the link to your X post.");
    const canonical = canonicalProofUrl(input.proofUrl);
    const tweetId = extractTweetId(canonical) ?? extractTweetId(input.proofUrl);
    if (!tweetId) throw errors.badRequest("That link is not a specific X post. Open your post and copy its link.");
    contentHash = sha256(`xpost:${tweetId}`);
    proofUrl = `https://x.com/i/status/${tweetId}`;
    proofType = "x_post";
    const handle = input.proofText ? normalizeXHandle(input.proofText) : user.x_username;

    const check = await verifyXPost({
      tweetId,
      expectedUsername: handle,
      campaignStartMs: settings.campaignStartsAt,
    });
    verificationState = check.state === "verified" ? "verified" : check.state === "failed" ? "failed" : "manual";
    verificationDetail = truncate(check.detail, 400);
    if (check.state === "failed") {
      throw errors.badRequest(check.detail);
    }
    if (check.state === "verified" && check.tweet?.author_username) {
      // Bind the participant to the account that actually published the post.
      const author = `@${check.tweet.author_username.replace(/^@/, "")}`;
      if (!user.x_username) xHandleUpdate = author;
      proofText = author;
    }
    if (!handle && check.state !== "verified") {
      throw errors.badRequest(
        "Add your X username too, so the team can verify authorship manually.",
      );
    }
    if (handle && !user.x_username) xHandleUpdate = handle;
  } else {
    if (task.requires_proof && !input.proofUrl && !input.proofText) {
      throw errors.badRequest("Add a link or description as proof for this task.");
    }
    if (input.proofUrl) {
      const canonical = canonicalProofUrl(input.proofUrl);
      proofUrl = canonical.startsWith("x:") || canonical.startsWith("telegram")
        ? canonical
        : input.proofUrl.trim();
      proofType = "link";
      contentHash = sha256(`link:${canonical}`);
    } else {
      proofText = input.proofText?.trim().slice(0, 2000) ?? null;
      if (!proofText) throw errors.badRequest("Add a short description for your submission.");
      contentHash = sha256(`text:${proofText.toLowerCase().replace(/\s+/g, " ")}`);
      proofType = "text";
    }
    if (input.proofText && input.proofUrl) {
      proofText = input.proofText.trim().slice(0, 2000);
    }
    verificationState = "manual";
    verificationDetail = "Queued for manual review by the OFFR team.";
  }

  const ts = now();
  const id = newId("sub");
  try {
    await execute(
      `INSERT INTO submissions (id, user_id, task_id, status, proof_type, proof_url, proof_text, content_hash,
        points_awarded, verification_state, verification_detail, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        id,
        user.id,
        task.id,
        proofType,
        proofUrl,
        proofText,
        contentHash,
        verificationState,
        verificationDetail,
        ts,
        ts,
      ],
    );
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/unique|duplicate/i.test(message)) {
      throw errors.conflict(
        "You already have a submission awaiting review for this task, or that exact proof was already submitted.",
      );
    }
    throw err;
  }

  if (xHandleUpdate) {
    await updateUser(user.id, { x_username: xHandleUpdate });
  }

  await execute(
    `INSERT INTO verifications (id, user_id, submission_id, kind, status, method, detail, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("ver"),
      user.id,
      id,
      task.type,
      verificationState === "verified" ? "verified" : verificationState === "failed" ? "failed" : "manual",
      verificationState === "verified" ? "api" : "manual",
      verificationDetail,
      ts,
    ],
  );

  await recordAudit({
    actorType: "user",
    actorId: user.id,
    action: "submission.created",
    targetType: "submission",
    targetId: id,
    meta: { task: task.slug, verificationState },
    ip: input.ip,
  });

  const row = await queryOne<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, [id]);
  if (!row) throw errors.server("Submission could not be saved.");
  return row;
}

export interface ReviewInput {
  submissionId: string;
  adminId: string;
  action: "approve" | "reject" | "revoke";
  points?: number;
  note?: string;
  ip?: string;
}

export interface ReviewResult {
  submission: SubmissionRow;
  pointsAwarded: number;
  referralCredited: boolean;
}

export async function reviewSubmission(input: ReviewInput): Promise<ReviewResult> {
  const settings = await getSettings();
  const submission = await queryOne<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, [
    input.submissionId,
  ]);
  if (!submission) throw errors.notFound("Submission not found.");

  const task = await queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [submission.task_id]);
  if (!task) throw errors.notFound("Task not found for this submission.");

  const user = await getUserById(submission.user_id);
  if (!user) throw errors.notFound("Participant not found.");

  const note = input.note?.trim().slice(0, 1000) || null;
  const ts = now();
  let pointsAwarded = 0;
  let referralCredited = false;

  if (input.action === "approve") {
    if (submission.status !== "pending") {
      throw errors.conflict("Only pending submissions can be approved.");
    }
    const requested = input.points ?? task.points;
    if (!Number.isFinite(requested) || requested <= 0) {
      throw errors.badRequest("Awarded points must be a positive number.");
    }
    if (requested > task.points) {
      throw errors.badRequest(`Points cannot exceed the task weight (${task.points}).`);
    }
    // Ledger (not the cached column) is the source of truth for the cap, so a
    // stale cache or a parallel approval cannot over-award.
    const currentPoints = await getPoints(user.id);
    const room = settings.maxPointsPerUser - currentPoints;
    if (room <= 0) {
      throw errors.conflict("This participant has already reached the campaign points cap.");
    }
    pointsAwarded = Math.min(Math.round(requested), room);

    // Atomic compare-and-set: exactly one concurrent reviewer can flip
    // pending -> approved. The loser gets a 409 and credits nothing.
    const flip = await execute(
      `UPDATE submissions SET status = 'approved', points_awarded = ?, reviewed_at = ?, reviewed_by = ?,
        review_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      [pointsAwarded, ts, input.adminId, note, ts, submission.id],
    );
    if (flip.changes !== 1) {
      throw errors.conflict("This submission was already reviewed. Reload the queue.");
    }

    await addPoints({
      userId: user.id,
      delta: pointsAwarded,
      reason: "submission_approved",
      submissionId: submission.id,
      createdBy: input.adminId,
    });

    await execute(
      `INSERT INTO verifications (id, user_id, submission_id, kind, status, method, detail, checked_at)
       VALUES (?, ?, ?, ?, 'verified', 'manual', ?, ?)`,
      [
        newId("ver"),
        user.id,
        submission.id,
        `review:${task.type}`,
        `Approved by admin${note ? `: ${note}` : ""}`,
        ts,
      ],
    );

    referralCredited = await creditReferral(user, settings, input.adminId);
  } else if (input.action === "reject") {
    if (submission.status === "paid") {
      throw errors.conflict("Paid submissions cannot be rejected.");
    }
    const flip = await execute(
      `UPDATE submissions SET status = 'rejected', points_awarded = 0, reviewed_at = ?, reviewed_by = ?,
        review_note = ?, updated_at = ? WHERE id = ? AND status IN ('pending','approved')`,
      [ts, input.adminId, note, ts, submission.id],
    );
    if (flip.changes !== 1) {
      throw errors.conflict("This submission was already reviewed. Reload the queue.");
    }
    if (submission.status === "approved") {
      await addPoints({
        userId: user.id,
        delta: -Math.abs(submission.points_awarded),
        reason: "submission_revoked",
        submissionId: submission.id,
        createdBy: input.adminId,
      });
    }
  } else {
    // revoke: approved -> rejected, points removed
    if (submission.status !== "approved") {
      throw errors.conflict("Only approved submissions can be revoked.");
    }
    const flip = await execute(
      `UPDATE submissions SET status = 'rejected', points_awarded = 0, reviewed_at = ?, reviewed_by = ?,
        review_note = ?, updated_at = ? WHERE id = ? AND status = 'approved'`,
      [ts, input.adminId, note ?? "Revoked by admin", ts, submission.id],
    );
    if (flip.changes !== 1) {
      throw errors.conflict("Only approved submissions can be revoked. Reload the queue.");
    }
    await addPoints({
      userId: user.id,
      delta: -Math.abs(submission.points_awarded),
      reason: "submission_revoked",
      submissionId: submission.id,
      createdBy: input.adminId,
    });
  }

  await recordAudit({
    actorType: "admin",
    actorId: input.adminId,
    action: `submission.${input.action}`,
    targetType: "submission",
    targetId: submission.id,
    meta: { task: task.slug, user: user.wallet, pointsAwarded, note },
    ip: input.ip,
  });

  const refreshed = await queryOne<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, [
    submission.id,
  ]);
  return { submission: refreshed!, pointsAwarded, referralCredited };
}

/** Credits the referrer once, after the referee's first approved submission. */
export async function creditReferral(
  referee: UserRow,
  settings: CampaignSettings,
  actorId: string,
): Promise<boolean> {
  if (!referee.referred_by || referee.referral_credited) return false;
  if (settings.referralPoints <= 0) return false;

  const referrer = await getUserById(referee.referred_by);
  if (!referrer || isBlocked(referrer)) return false;

  const count = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users WHERE referred_by = ? AND referral_credited = 1`,
    [referrer.id],
  );
  if (Number(count?.c ?? 0) >= settings.maxReferralsPerUser) return false;

  // Claim the referral atomically first: two simultaneous approvals for the same
  // referee must credit the referrer exactly once.
  const claim = await execute(
    `UPDATE users SET referral_credited = 1 WHERE id = ? AND referral_credited = 0`,
    [referee.id],
  );
  if (claim.changes !== 1) return false;

  await addPoints({
    userId: referrer.id,
    delta: settings.referralPoints,
    reason: "referral_credited",
    createdBy: actorId,
  });

  await recordAudit({
    actorType: "system",
    actorId,
    action: "referral.credited",
    targetType: "user",
    targetId: referrer.id,
    meta: { referee: referee.wallet, points: settings.referralPoints },
  });
  return true;
}

/**
 * Creates (or refreshes) a pending claim that already carries server-side
 * verification evidence — used for Telegram membership and on-chain holding,
 * which cannot be submitted through the generic proof form.
 */
export async function ensureAutoClaim(args: {
  user: UserRow;
  taskSlug: string;
  contentHash: string;
  verificationState: SubmissionRow["verification_state"];
  verificationDetail: string;
  method: string;
}): Promise<SubmissionRow | null> {
  const task = await getTaskBySlug(args.taskSlug);
  if (!task || !task.active) return null;

  const existing = await query<SubmissionRow>(
    `SELECT * FROM submissions WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC`,
    [args.user.id, task.id],
  );
  if (existing.some((s) => s.status === "approved" || s.status === "paid")) return null;

  const pending = existing.find((s) => s.status === "pending");
  if (pending) {
    await execute(
      `UPDATE submissions SET verification_state = ?, verification_detail = ?, updated_at = ? WHERE id = ?`,
      [args.verificationState, truncate(args.verificationDetail, 400), now(), pending.id],
    );
    return { ...pending, verification_state: args.verificationState };
  }

  // A previously rejected auto-claim must be re-openable once the participant
  // satisfies the rule (e.g. they now hold enough OFFR for the required days).
  const rejected = existing.find((s) => s.status === "rejected");
  if (rejected) {
    const reopened = await execute(
      `UPDATE submissions SET status = 'pending', verification_state = ?, verification_detail = ?,
        reviewed_at = NULL, reviewed_by = NULL, review_note = NULL, updated_at = ?
       WHERE id = ? AND status = 'rejected'`,
      [args.verificationState, truncate(args.verificationDetail, 400), now(), rejected.id],
    );
    if (reopened.changes === 1) {
      await execute(
        `INSERT INTO verifications (id, user_id, submission_id, kind, status, method, detail, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId("ver"),
          args.user.id,
          rejected.id,
          task.type,
          "verified",
          args.method,
          truncate(args.verificationDetail, 400),
          now(),
        ],
      );
      await recordAudit({
        actorType: "system",
        actorId: null,
        action: "submission.auto_reopened",
        targetType: "submission",
        targetId: rejected.id,
        meta: { task: task.slug },
      });
      return queryOne<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, [rejected.id]);
    }
  }

  const ts = now();
  const id = newId("sub");
  try {
    await execute(
      `INSERT INTO submissions (id, user_id, task_id, status, proof_type, proof_url, proof_text, content_hash,
        points_awarded, verification_state, verification_detail, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 'auto', NULL, ?, ?, 0, ?, ?, ?, ?)`,
      [
        id,
        args.user.id,
        task.id,
        truncate(args.verificationDetail, 500),
        args.contentHash,
        args.verificationState,
        truncate(args.verificationDetail, 400),
        ts,
        ts,
      ],
    );
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/unique|duplicate/i.test(message)) {
      // Lost a race with another verifier: re-open that row if it was rejected.
      const clash = await queryOne<SubmissionRow>(
        `SELECT * FROM submissions WHERE task_id = ? AND content_hash = ?`,
        [task.id, args.contentHash],
      );
      if (clash?.status === "rejected") {
        await execute(
          `UPDATE submissions SET status = 'pending', verification_state = ?, verification_detail = ?,
            reviewed_at = NULL, reviewed_by = NULL, updated_at = ? WHERE id = ? AND status = 'rejected'`,
          [args.verificationState, truncate(args.verificationDetail, 400), now(), clash.id],
        );
        return queryOne<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, [clash.id]);
      }
      return null;
    }
    throw err;
  }

  await execute(
    `INSERT INTO verifications (id, user_id, submission_id, kind, status, method, detail, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("ver"),
      args.user.id,
      id,
      task.type,
      args.verificationState === "failed" ? "failed" : "verified",
      args.method,
      truncate(args.verificationDetail, 400),
      ts,
    ],
  );

  await recordAudit({
    actorType: "system",
    actorId: null,
    action: "submission.auto_verified",
    targetType: "submission",
    targetId: id,
    meta: { task: task.slug, state: args.verificationState },
  });

  return queryOne<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, [id]);
}

export async function listSubmissionsForAdmin(filters: {
  status?: string;
  taskId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status && filters.status !== "all") {
    where.push(`s.status = ?`);
    params.push(filters.status);
  }
  if (filters.taskId) {
    where.push(`s.task_id = ?`);
    params.push(filters.taskId);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query(
    `SELECT s.*, u.wallet, u.x_username, u.telegram_username, t.title AS task_title, t.slug AS task_slug,
            t.type AS task_type, t.points AS task_points,
            (SELECT COUNT(*) FROM submissions x WHERE x.user_id = s.user_id) AS user_submission_count
     FROM submissions s
     JOIN users u ON u.id = s.user_id
     JOIN tasks t ON t.id = s.task_id
     ${clause}
     ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 50, filters.offset ?? 0],
  );
}
