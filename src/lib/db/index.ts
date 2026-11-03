import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { env } from "@/lib/env";
import { migrations } from "./migrations";

export type SqlParam = string | number | null;
export type Dialect = "sqlite" | "postgres";

export interface Queryable {
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
}

interface Adapter extends Queryable {
  dialect: Dialect;
  execRaw(sql: string): Promise<void>;
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

function normalizeParams(params: SqlParam[] = []): SqlParam[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (typeof p === "number" && !Number.isFinite(p)) {
      throw new Error(`Invalid numeric SQL parameter: ${p}`);
    }
    return p;
  });
}

/** Convert `?` placeholders to PostgreSQL `$n`, skipping quoted literals. */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
    } else if (ch === "?" && !inSingle && !inDouble) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

async function createSqliteAdapter(file: string): Promise<Adapter> {
  // better-sqlite3 is an optional dependency: PostgreSQL deployments do not need
  // the native module, so a failed native build must not break the install.
  // The specifier is resolved at runtime (never bundled) so webpack does not
  // require the package to exist at build time.
  const runtimeRequire = createRequire(import.meta.url);
  const driverName = "better-sqlite3";
  let Database: typeof import("better-sqlite3");
  try {
    Database = runtimeRequire(driverName);
  } catch {
    throw new Error(
      "SQLite driver (better-sqlite3) is not installed on this host. Set DATABASE_URL to a PostgreSQL connection string, or install the optional dependency.",
    );
  }
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const q: Adapter = {
    dialect: "sqlite",
    async all<T>(sql: string, params?: SqlParam[]) {
      return db.prepare(sql).all(...normalizeParams(params)) as T[];
    },
    async get<T>(sql: string, params?: SqlParam[]) {
      const row = db.prepare(sql).get(...normalizeParams(params));
      return (row ?? null) as T | null;
    },
    async run(sql: string, params?: SqlParam[]) {
      const info = db.prepare(sql).run(...normalizeParams(params));
      return { changes: info.changes };
    },
    async execRaw(sql: string) {
      db.exec(sql);
    },
    async transaction<T>(fn: (t: Queryable) => Promise<T>) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(q);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore rollback failure */
        }
        throw err;
      }
    },
  };
  return q;
}

async function createPostgresAdapter(connectionString: string): Promise<Adapter> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(connectionString, {
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // safe behind PgBouncer / serverless poolers
    onnotice: () => {},
  });

  const wrap = (client: typeof sql): Queryable => ({
    async all<T>(text: string, params?: SqlParam[]) {
      const rows = await client.unsafe(toPgPlaceholders(text), (normalizeParams(params) as never[]) ?? []);
      return rows as unknown as T[];
    },
    async get<T>(text: string, params?: SqlParam[]) {
      const rows = (await client.unsafe(
        toPgPlaceholders(text),
        (normalizeParams(params) as never[]) ?? [],
      )) as unknown as T[];
      return (rows[0] ?? null) as T | null;
    },
    async run(text: string, params?: SqlParam[]) {
      const res = await client.unsafe(
        toPgPlaceholders(text),
        (normalizeParams(params) as never[]) ?? [],
      );
      return { changes: Number((res as unknown as { count?: number }).count ?? res.length ?? 0) };
    },
  });

  return {
    ...wrap(sql),
    dialect: "postgres",
    async execRaw(text: string) {
      await sql.unsafe(text);
    },
    async transaction<T>(fn: (t: Queryable) => Promise<T>) {
      return (await sql.begin(async (tx) => fn(wrap(tx as unknown as typeof sql)))) as T;
    },
  };
}

const globalForDb = globalThis as unknown as {
  __offrDb?: Promise<Adapter>;
  __offrMigrated?: Promise<void>;
};

async function getAdapter(): Promise<Adapter> {
  if (!globalForDb.__offrDb) {
    globalForDb.__offrDb = (async () => {
      if (env.databaseUrl && /^postgres(ql)?:\/\//.test(env.databaseUrl)) {
        return createPostgresAdapter(env.databaseUrl);
      }
      return createSqliteAdapter(env.sqlitePath);
    })();
  }
  return globalForDb.__offrDb;
}

async function applyMigrations(db: Adapter): Promise<void> {
  await db.execRaw(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`);
  const applied = await db.all<{ version: string }>(`SELECT version FROM schema_migrations`);
  const done = new Set(applied.map((r) => r.version));
  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    for (const statement of migration.statements) {
      await db.execRaw(statement);
    }
    await db.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, [
      migration.version,
      Date.now(),
    ]);
  }
}

/** Connect (once per process) and ensure the schema exists. */
export async function getDb(): Promise<Adapter> {
  const db = await getAdapter();
  if (!globalForDb.__offrMigrated) {
    globalForDb.__offrMigrated = applyMigrations(db);
  }
  await globalForDb.__offrMigrated;
  return db;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: SqlParam[],
): Promise<T[]> {
  const db = await getDb();
  return db.all<T>(sql, params);
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: SqlParam[],
): Promise<T | null> {
  const db = await getDb();
  return db.get<T>(sql, params);
}

export async function execute(sql: string, params?: SqlParam[]): Promise<{ changes: number }> {
  const db = await getDb();
  return db.run(sql, params);
}

export async function transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export async function dialect(): Promise<Dialect> {
  return (await getDb()).dialect;
}

export function newId(prefix?: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id.slice(0, 24)}` : id;
}
