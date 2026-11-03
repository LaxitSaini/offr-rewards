import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, toPgPlaceholders, type Adapter, type SqlParam } from "@/lib/db";
import { migrations } from "@/lib/db/migrations";

/**
 * Service-layer proof on a real PostgreSQL engine.
 *
 * `tests/postgres-compat.test.ts` proves the DDL and a couple of hand-written
 * statements. This file goes further: it installs a Postgres-backed adapter into
 * the application's own adapter slot and then drives the *production service
 * functions* — sessions, rate limiting, task submission, review/approval,
 * referral credit, payouts, dashboard, leaderboard — so the SQL those functions
 * actually emit is exercised on the Postgres grammar, not just SQLite.
 *
 * Why this matters for the free deployment: the card-free target is a serverless
 * host (no SQLite file), so PostgreSQL is the production database. A dialect bug
 * in the reward or payout path would be a money bug.
 *
 * What this does NOT prove: TLS, connection pooling, PgBouncer transaction mode,
 * cold-start latency, or Neon-specific failure modes. Those need the hosted
 * smoke test described in docs/DEPLOYMENT-FREE.md.
 */

// `next/headers` needs a live request scope; a tiny in-memory jar lets the real
// createSession / readSession / destroySession run against PostgreSQL here.
const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const db = new PGlite();

/** Match the `postgres` driver's type mapping: int8 comes back as a string. */
function normalizeRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === "bigint" ? value.toString() : value;
    }
    return out as T;
  });
}

function pgliteAdapter(engine: PGlite): Adapter {
  const query = async (text: string, params?: SqlParam[]) => {
    const res = await engine.query<Record<string, unknown>>(
      toPgPlaceholders(text),
      (params ?? []) as unknown[],
    );
    return res;
  };
  const all = async <T>(text: string, params?: SqlParam[]) =>
    normalizeRows<T>((await query(text, params)).rows);
  return {
    dialect: "postgres",
    all,
    get: async <T>(text: string, params?: SqlParam[]) => ((await all<T>(text, params))[0] ?? null) as T | null,
    run: async (text: string, params?: SqlParam[]) => ({ changes: (await query(text, params)).affectedRows ?? 0 }),
    execRaw: async (text: string) => {
      await engine.exec(text);
    },
    transaction: async <T>(fn: (q: Adapter) => Promise<T>) => {
      await engine.exec("BEGIN");
      try {
        const result = await fn(pgliteAdapter(engine));
        await engine.exec("COMMIT");
        return result;
      } catch (err) {
        await engine.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

const adapter = pgliteAdapter(db);

let services: {
  getOrCreateUser: typeof import("@/lib/users").getOrCreateUser;
  getPoints: typeof import("@/lib/users").getPoints;
  submitTask: typeof import("@/lib/services/submissions").submitTask;
  reviewSubmission: typeof import("@/lib/services/submissions").reviewSubmission;
  creditReferral: typeof import("@/lib/services/submissions").creditReferral;
  recordPayout: typeof import("@/lib/services/payouts").recordPayout;
  createSession: typeof import("@/lib/auth/session").createSession;
  destroySession: typeof import("@/lib/auth/session").destroySession;
  readSession: typeof import("@/lib/auth/session").readSession;
  rateLimit: typeof import("@/lib/ratelimit").rateLimit;
  getDashboard: typeof import("@/lib/services/dashboard").getDashboard;
  getLeaderboard: typeof import("@/lib/services/dashboard").getLeaderboard;
  getPublicStats: typeof import("@/lib/services/dashboard").getPublicStats;
  getSettings: typeof import("@/lib/settings").getSettings;
  ensureBoot: typeof import("@/lib/bootstrap").ensureBoot;
  getDb: typeof import("@/lib/db").getDb;
};

function wallet(seed: number): string {
  return `0x${String(seed).padStart(40, "0")}`;
}

beforeAll(async () => {
  const globals = globalThis as unknown as { __offrDb?: Promise<Adapter>; __offrMigrated?: Promise<void> };
  globals.__offrDb = Promise.resolve(adapter);
  globals.__offrMigrated = undefined;

  const dbModule = await import("@/lib/db");
  await dbModule.getDb(); // applies the real migrations through the injected adapter

  const [users, submissions, payouts, session, ratelimit, dashboard, settings, bootstrap] =
    await Promise.all([
      import("@/lib/users"),
      import("@/lib/services/submissions"),
      import("@/lib/services/payouts"),
      import("@/lib/auth/session"),
      import("@/lib/ratelimit"),
      import("@/lib/services/dashboard"),
      import("@/lib/settings"),
      import("@/lib/bootstrap"),
    ]);

  services = {
    getOrCreateUser: users.getOrCreateUser,
    getPoints: users.getPoints,
    submitTask: submissions.submitTask,
    reviewSubmission: submissions.reviewSubmission,
    creditReferral: submissions.creditReferral,
    recordPayout: payouts.recordPayout,
    createSession: session.createSession,
    destroySession: session.destroySession,
    readSession: session.readSession,
    rateLimit: ratelimit.rateLimit,
    getDashboard: dashboard.getDashboard,
    getLeaderboard: dashboard.getLeaderboard,
    getPublicStats: dashboard.getPublicStats,
    getSettings: settings.getSettings,
    ensureBoot: bootstrap.ensureBoot,
    getDb: dbModule.getDb,
  };

  // The shared vitest config disables rate limiting so unrelated tests stay
  // deterministic; this file needs the real limiter to prove it works on
  // PostgreSQL.
  const mutableEnv = (await import("@/lib/env")).env as { rateLimitDisabled: boolean };
  mutableEnv.rateLimitDisabled = false;

  await services.ensureBoot();
  await services.ensureBoot(); // idempotent seed
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("PostgreSQL: schema and bootstrap", () => {
  it("records every migration", async () => {
    const rows = await adapter.all<{ version: string }>(`SELECT version FROM schema_migrations`);
    expect(rows.map((r) => r.version).sort()).toEqual(migrations.map((m) => m.version).sort());
  });

  it("seeds the campaign settings and task catalogue exactly once", async () => {
    const settings = await services.getSettings();
    expect(settings.campaignName.length).toBeGreaterThan(1);
    const tasks = await adapter.all<{ n: number }>(`SELECT COUNT(*)::int AS n FROM tasks`);
    expect(Number(tasks[0]!.n)).toBe(6);
  });
});

describe("PostgreSQL: sessions", () => {
  it("creates, reads and revokes a participant session", async () => {
    const { user } = await services.getOrCreateUser({ wallet: wallet(101), ip: "203.0.113.10" });
    const created = await services.createSession({ kind: "user", userId: user.id, ip: "203.0.113.10" });

    const row = await services.readSession("user");
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(user.id);
    expect(row!.csrf).toBe(created.csrf);
    expect(row!.revoked_at).toBeNull();

    await services.destroySession("user");
    expect(await services.readSession("user")).toBeNull();

    const after = await adapter.all<{ revoked_at: number | null }>(
      `SELECT revoked_at FROM sessions WHERE user_id = ?`,
      [user.id],
    );
    expect(after).toHaveLength(1);
    expect(Number(after[0]!.revoked_at)).toBeGreaterThan(0);
  });

  it("stores only a hash of the session token", async () => {
    const { user } = await services.getOrCreateUser({ wallet: wallet(102) });
    const created = await services.createSession({ kind: "user", userId: user.id });
    const rows = await adapter.all<{ id: string }>(`SELECT id FROM sessions WHERE user_id = ?`, [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(created.token);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    await services.destroySession("user");
  });
});

describe("PostgreSQL: rate limiting", () => {
  it("blocks after the limit inside one window and reports a retry delay", async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    const first = await services.rateLimit(key, 3, 60_000);
    const second = await services.rateLimit(key, 3, 60_000);
    const third = await services.rateLimit(key, 3, 60_000);
    const fourth = await services.rateLimit(key, 3, 60_000);
    expect([first.ok, second.ok, third.ok]).toEqual([true, true, true]);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("PostgreSQL: participation and reward accounting", () => {
  it("submits a task and reviews it, crediting points exactly once", async () => {
    const { user } = await services.getOrCreateUser({ wallet: wallet(201), ip: "203.0.113.20" });
    const submission = await services.submitTask({
      user,
      taskSlug: "meme",
      proofText: `https://x.com/offr_test/status/${Date.now()}`,
      ip: "203.0.113.20",
    });
    expect(submission.status).toBe("pending");

    const result = await services.reviewSubmission({
      submissionId: submission.id,
      adminId: "adm_postgres_test",
      action: "approve",
      note: "postgres path",
    });
    expect(result.submission.status).toBe("approved");
    expect(result.pointsAwarded).toBeGreaterThan(0);

    const points = await services.getPoints(user.id);
    expect(points).toBe(result.pointsAwarded);

    const ledger = await adapter.all<{ delta: number; reason: string }>(
      `SELECT delta, reason FROM points_ledger WHERE user_id = ?`,
      [user.id],
    );
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0]!.delta)).toBe(result.pointsAwarded);
    expect(ledger[0]!.reason).toBe("submission_approved");

    const audit = await adapter.all<{ action: string }>(
      `SELECT action FROM audit_log WHERE target_id = ?`,
      [submission.id],
    );
    expect(audit.map((a) => a.action)).toContain("submission.approve");
  });

  it("lets only one of two concurrent approvals win", async () => {
    const { user } = await services.getOrCreateUser({ wallet: wallet(202), ip: "203.0.113.21" });
    const submission = await services.submitTask({
      user,
      taskSlug: "content",
      proofText: `https://example.com/article/${Date.now()}`,
      ip: "203.0.113.21",
    });

    const settle = await Promise.allSettled([
      services.reviewSubmission({ submissionId: submission.id, adminId: "adm_a", action: "approve" }),
      services.reviewSubmission({ submissionId: submission.id, adminId: "adm_b", action: "approve" }),
    ]);
    const wins = settle.filter((s) => s.status === "fulfilled");
    const losses = settle.filter((s) => s.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);

    const ledger = await adapter.all<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM points_ledger WHERE user_id = ?`,
      [user.id],
    );
    expect(Number(ledger[0]!.n)).toBe(1);
  });

  it("credits a referral once, not once per approval", async () => {
    const referrer = await services.getOrCreateUser({ wallet: wallet(301), ip: "203.0.113.30" });
    const settings = await services.getSettings();
    const referee = await services.getOrCreateUser({
      wallet: wallet(302),
      ip: "203.0.113.31",
      referralCode: referrer.user.referral_code,
    });
    expect(referee.user.referred_by).toBe(referrer.user.id);

    const submission = await services.submitTask({
      user: referee.user,
      taskSlug: "meme",
      proofText: `https://x.com/offr_test/status/${Date.now()}1`,
      ip: "203.0.113.31",
    });
    await services.reviewSubmission({
      submissionId: submission.id,
      adminId: "adm_postgres_test",
      action: "approve",
    });

    const first = await services.getPoints(referrer.user.id);
    expect(first).toBe(settings.referralPoints);

    const again = await services.creditReferral(referee.user, settings, "adm_postgres_test");
    expect(again).toBe(false);
    expect(await services.getPoints(referrer.user.id)).toBe(settings.referralPoints);
  });
});

describe("PostgreSQL: payout guards", () => {
  it("records a payout and refuses to exceed the per-participant cap", async () => {
    const { user } = await services.getOrCreateUser({ wallet: wallet(401), ip: "203.0.113.40" });
    const settings = await services.getSettings();

    const payout = await services.recordPayout({
      userId: user.id,
      amount: "10",
      adminId: "adm_postgres_test",
      overrideHoldRequirement: true,
      note: "postgres path",
    });
    expect(payout.status).toBe("recorded");

    await expect(
      services.recordPayout({
        userId: user.id,
        amount: settings.maxRewardPerUserOffr,
        adminId: "adm_postgres_test",
        overrideHoldRequirement: true,
      }),
    ).rejects.toThrow(/cap/i);
  });

  it("keeps the paid total readable after a big amount", async () => {
    const rows = await adapter.all<{ total: string | null }>(
      `SELECT SUM(CAST(amount AS DECIMAL(30,6))) AS total FROM payouts WHERE status IN ('recorded','verified')`,
    );
    expect(Number(rows[0]!.total)).toBeGreaterThan(0);
  });
});

describe("PostgreSQL: read models", () => {
  it("serves dashboard, leaderboard and public stats without dialect errors", async () => {
    const referrer = (await services.getOrCreateUser({ wallet: wallet(301) })).user;
    const dashboard = await services.getDashboard(referrer);
    expect(dashboard.user.points).toBeGreaterThan(0);
    expect(dashboard.tasks.length).toBeGreaterThan(0);

    const leaderboard = await services.getLeaderboard(10);
    expect(leaderboard.length).toBeGreaterThan(0);
    expect(leaderboard[0]!.points).toBeGreaterThan(0);

    const stats = await services.getPublicStats();
    expect(stats.participants).toBeGreaterThanOrEqual(4);
  });
});
