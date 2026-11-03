import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, toPgPlaceholders, type Adapter, type SqlParam } from "@/lib/db";
import { migrations } from "@/lib/db/migrations";
import { now, randomToken } from "@/lib/utils";

/**
 * PostgreSQL honesty check.
 *
 * The application cannot reach a managed Postgres server from this sandbox, so
 * instead of claiming "tested on Postgres" from a type-check alone, the real
 * migrations and the real Postgres placeholder path are executed against an
 * in-process Postgres engine (PGlite = Postgres compiled to WASM).
 *
 * What this proves: the DDL runs on the Postgres grammar, partial unique indexes
 * work, `?` -> `$n` conversion is applied, and the atomic payout gate behaves
 * identically. What it does NOT prove: connection pooling, TLS, PgBouncer
 * behaviour, latency or backup/restore against a hosted database.
 */

function pgliteAdapter(db: PGlite): Adapter {
  const run = async (text: string, params?: SqlParam[]) => {
    const res = await db.query(toPgPlaceholders(text), (params ?? []) as unknown[]);
    return res.affectedRows;
  };
  const all = async <T>(text: string, params?: SqlParam[]) => {
    const res = await db.query(toPgPlaceholders(text), (params ?? []) as unknown[]);
    return res.rows as T[];
  };
  return {
    dialect: "postgres",
    all,
    get: async <T>(text: string, params?: SqlParam[]) => ((await all<T>(text, params))[0] ?? null) as T | null,
    run: async (text: string, params?: SqlParam[]) => ({ changes: (await run(text, params)) ?? 0 }),
    execRaw: async (text: string) => {
      await db.exec(text);
    },
    transaction: async <T>(fn: (q: Adapter) => Promise<T>) => {
      await db.exec("BEGIN");
      try {
        const result = await fn(pgliteAdapter(db));
        await db.exec("COMMIT");
        return result;
      } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

const db = new PGlite();
let adapter: Adapter;

beforeAll(async () => {
  adapter = pgliteAdapter(db);
  await applyMigrations(adapter);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("PostgreSQL migration path", () => {
  it("applies every migration on a real Postgres engine", async () => {
    const rows = await adapter.all<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`);
    const versions = rows.map((r) => r.version);
    expect(versions).toEqual(migrations.map((m) => m.version));
  });

  it("is idempotent when the bootstrap runs twice", async () => {
    await applyMigrations(adapter);
    const rows = await adapter.all<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM schema_migrations`,
    );
    expect(Number(rows[0]!.c)).toBe(migrations.length);
  });

  it("exposes the expected tables", async () => {
    const rows = await adapter.all<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const table of ["users", "submissions", "payouts", "points_ledger", "settings", "rate_limits"]) {
      expect(names).toContain(table);
    }
  });

  it("converts ? placeholders to $n without touching literals", () => {
    expect(toPgPlaceholders(`SELECT * FROM t WHERE a = ? AND b = '?'`)).toBe(
      `SELECT * FROM t WHERE a = $1 AND b = '?'`,
    );
    expect(toPgPlaceholders(`INSERT INTO t (a, b) VALUES (?, ?)`)).toBe(
      `INSERT INTO t (a, b) VALUES ($1, $2)`,
    );
  });

  it("rejects a second pending submission for the same wallet and task", async () => {
    const userId = `usr_${randomToken(8)}`;
    const taskId = `tsk_${randomToken(8)}`;
    const ts = now();
    await adapter.run(
      `INSERT INTO users (id, wallet, referral_code, created_at) VALUES (?, ?, ?, ?)`,
      [userId, `0x${randomToken(20)}`, randomToken(8).toUpperCase(), ts],
    );
    await adapter.run(
      `INSERT INTO tasks (id, slug, title, description, type, points, created_at, updated_at)
       VALUES (?, ?, 'T', 'D', 'custom', 10, ?, ?)`,
      [taskId, `t-${randomToken(6)}`, ts, ts],
    );
    const insertPending = () =>
      adapter.run(
        `INSERT INTO submissions (id, user_id, task_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
        [`sub_${randomToken(8)}`, userId, taskId, ts, ts],
      );

    await insertPending();
    await expect(insertPending()).rejects.toThrow(/unique|duplicate/i);
  });

  it("enforces the atomic payout budget gate", async () => {
    const ts = now();
    await adapter.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('campaign', '{}', ?)`,
      [ts],
    );
    const userId = `usr_${randomToken(8)}`;
    await adapter.run(
      `INSERT INTO users (id, wallet, referral_code, created_at) VALUES (?, ?, ?, ?)`,
      [userId, `0x${randomToken(20)}`, randomToken(8).toUpperCase(), ts],
    );

    const gate = (id: string, amount: string, budget: string) =>
      adapter.run(
        `INSERT INTO payouts (id, user_id, amount, amount_raw, tx_hash, status, chain_id, note,
          verification_detail, verified_at, created_by, created_at)
         SELECT ?, ?, ?, ?, NULL, 'recorded', 8453, NULL, NULL, NULL, 'adm_test', ?
         WHERE (SELECT COALESCE(SUM(CAST(amount AS DECIMAL(30,6))), 0) FROM payouts
                  WHERE status IN ('recorded','verified'))
               + CAST(? AS DECIMAL(30,6)) <= CAST(? AS DECIMAL(30,6))`,
        [id, userId, amount, "1000000000000000000", ts, amount, budget],
      );

    expect((await gate(`pay_${randomToken(8)}`, "60", "100")).changes).toBe(1);
    expect((await gate(`pay_${randomToken(8)}`, "60", "100")).changes).toBe(0);
    const total = await adapter.all<{ total: string | null }>(
      `SELECT SUM(CAST(amount AS DECIMAL(30,6))) AS total FROM payouts WHERE status IN ('recorded','verified')`,
    );
    expect(Number(total[0]!.total)).toBe(60);
  });

  it("keeps schema_migrations inserts conflict-safe", async () => {
    await adapter.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT (version) DO NOTHING`, [
      migrations[0]!.version,
      now(),
    ]);
    const rows = await adapter.all<{ c: number }>(`SELECT COUNT(*)::int AS c FROM schema_migrations`);
    expect(Number(rows[0]!.c)).toBe(migrations.length);
  });
});
