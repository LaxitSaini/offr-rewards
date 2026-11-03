import fs from "node:fs";
import path from "node:path";
import type postgresFactory from "postgres";
import { env, migrationUrl } from "@/lib/env";
import { migrations } from "./migrations";

export type SqlParam = string | number | null;
export type Dialect = "sqlite" | "postgres";

export interface Queryable {
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
}

export interface Adapter extends Queryable {
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

/** Loads a CommonJS module through the real Node loader, bypassing webpack shims. */
function loadFromAnchor(anchor: string, specifier: string): unknown {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule;
  if (typeof getBuiltin === "function") {
    const mod = getBuiltin("node:module") as { createRequire: (p: string) => (id: string) => unknown };
    return mod.createRequire(anchor)(specifier);
  }
  // Older Node (no process.getBuiltinModule): use the CommonJS require of the
  // module that is executing this function.
  // eslint-disable-next-line no-eval
  const runtimeRequire = (0, eval)("require") as (id: string) => unknown;
  return runtimeRequire(specifier);
}

async function createSqliteAdapter(file: string): Promise<Adapter> {
  // better-sqlite3 is an optional dependency: PostgreSQL deployments do not need
  // the native module, so a failed native build must not break the install.
  // The specifier is resolved at runtime (never bundled) so webpack does not
  // require the package to exist at build time.
  // Resolution order matters: the bundle-relative URL can point inside `.next`
  // (where node_modules is absent under some Next builds), so fall back to the
  // project root before giving up.
  const driverName = "better-sqlite3";
  let Database: typeof import("better-sqlite3");
  const attempts: string[] = [];
  // `node:module` is shimmed inside the webpack server bundle (its
  // `createRequire` is undefined at runtime) and `import.meta.url` is not usable
  // there either, so the real CommonJS loader is obtained from the runtime
  // itself and anchored on the project root.
  const anchors = [
    path.join(process.cwd(), "package.json"),
    ...(process.argv[1] ? [path.join(path.dirname(process.argv[1]), "package.json")] : []),
    path.join(path.dirname(process.execPath), "package.json"),
  ];
  const resolvers = anchors.map((anchor) => () => loadFromAnchor(anchor, driverName));
  let resolved: typeof import("better-sqlite3") | null = null;
  for (const attempt of resolvers) {
    try {
      resolved = attempt() as typeof import("better-sqlite3");
      break;
    } catch (err) {
      attempts.push((err as Error).message);
    }
  }
  if (!resolved) {
    throw new Error(
      `SQLite driver (better-sqlite3) could not be loaded (${attempts.join(" | ")}). ` +
        "Set DATABASE_URL to a PostgreSQL connection string, or reinstall the optional dependency " +
        "(`npm install better-sqlite3`).",
    );
  }
  Database = resolved;
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

type PgClient = ReturnType<typeof postgresFactory>;

/** Wrap any `postgres` client (pooled, direct or a transaction scope). */
function postgresAdapter(sql: PgClient): Adapter {
  const wrap = (client: PgClient): Queryable => ({
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
      return (await sql.begin(async (tx: unknown) => fn(wrap(tx as PgClient)))) as T;
    },
  };
}

async function createPostgresAdapter(connectionString: string): Promise<Adapter> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(connectionString, {
    // Serverless: one connection per invocation (env.pgPoolMax = 1) so a free
    // Postgres tier's connection limit is not exhausted by cold-start fan-out.
    max: env.pgPoolMax,
    idle_timeout: env.serverless ? 5 : 20,
    max_lifetime: env.serverless ? 60 : null,
    connect_timeout: 15,
    prepare: false, // safe behind PgBouncer / serverless poolers (Neon -pooler)
    onnotice: () => {},
  });
  return postgresAdapter(sql);
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
      if (env.serverless) {
        // Refuse loudly. A SQLite file on a read-only/ephemeral filesystem would
        // accept writes and lose them at the next cold start.
        throw new Error(
          "This deployment is serverless and has no DATABASE_URL. SQLite file storage does not persist on serverless hosts. " +
            "Create a free Postgres database (Neon/Supabase) and set DATABASE_URL. See docs/DEPLOYMENT-FREE.md.",
        );
      }
      return createSqliteAdapter(env.sqlitePath);
    })().catch((err: unknown) => {
      // Do not cache a failed boot: the next request should retry (a wrong
      // DATABASE_URL fixed in the dashboard must not require a redeploy).
      globalForDb.__offrDb = undefined;
      throw err;
    });
  }
  return globalForDb.__offrDb;
}

export async function applyMigrations(db: Adapter): Promise<void> {
  await db.execRaw(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`);
  const applied = await db.all<{ version: string }>(`SELECT version FROM schema_migrations`);
  const done = new Set(applied.map((r) => r.version));
  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    for (const statement of migration.statements) {
      try {
        await db.execRaw(statement);
      } catch (err) {
        const message = (err as Error).message ?? "";
        // Two serverless instances can race on startup; DDL is idempotent, so
        // "already exists" is not fatal.
        if (/already exists|duplicate key|duplicate/i.test(message)) {
          console.warn(`[db] migration ${migration.version}: statement already applied`);
          continue;
        }
        throw new Error(`Migration ${migration.version} failed: ${message}`);
      }
    }
    await db.run(
      `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT (version) DO NOTHING`,
      [migration.version, Date.now()],
    );
  }
}

/**
 * Apply the schema over the direct (non-pooled) connection when the host provides
 * one, then let it go. Neon's PgBouncer pool is fine for queries but its own
 * guidance is to run DDL on the direct endpoint; this also keeps a long DDL
 * statement from occupying a pooled slot.
 */
async function migrateOnce(db: Adapter): Promise<void> {
  if (db.dialect !== "postgres" || !migrationUrl) {
    await applyMigrations(db);
    return;
  }
  const postgres = (await import("postgres")).default;
  const direct = postgres(migrationUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    prepare: false,
    onnotice: () => {},
  });
  try {
    await applyMigrations(postgresAdapter(direct));
  } finally {
    await direct.end({ timeout: 5 }).catch(() => undefined);
  }
}

/** Connect (once per process) and ensure the schema exists. */
export async function getDb(): Promise<Adapter> {
  const db = await getAdapter();
  if (!globalForDb.__offrMigrated) {
    globalForDb.__offrMigrated = migrateOnce(db).catch((err: unknown) => {
      globalForDb.__offrMigrated = undefined;
      throw err;
    });
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
