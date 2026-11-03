/**
 * Database diagnostic.
 *
 * Run after install/deploy: `npm run check:db`.
 *
 * It answers the one question that silently breaks SQLite deployments: is the
 * optional native driver actually present, and can the schema be read?
 */
import { env, integrations } from "@/lib/env";
import { applyMigrations, getDb, queryOne, type Adapter } from "@/lib/db";
import { migrations } from "@/lib/db/migrations";

async function main(): Promise<void> {
  console.log(`\nOFFR Rewards — database check\n`);
  console.log(`  engine        : ${integrations.database}`);
  console.log(`  DATABASE_URL  : ${env.databaseUrl ? "set (value hidden)" : "not set"}`);
  if (!env.databaseUrl) console.log(`  SQLITE_PATH   : ${env.sqlitePath}`);

  let db: Adapter;
  try {
    db = await getDb();
  } catch (err) {
    console.error(`\n  ✖ Could not open the database: ${(err as Error).message}\n`);
    if (!env.databaseUrl) {
      console.error(
        "  → SQLite deployments need the optional native driver. Install it with:\n" +
          "      npm install better-sqlite3\n" +
          "    or install everything including optional dependencies:\n" +
          "      npm ci --include=optional\n" +
          "    PostgreSQL deployments can ignore this: set DATABASE_URL instead.\n",
      );
    }
    process.exit(1);
  }

  console.log(`  driver        : OK (${db.dialect})`);

  await applyMigrations(db);
  const applied = await db.all<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`);
  const missing = migrations.map((m) => m.version).filter((v) => !applied.some((a) => a.version === v));
  console.log(`  migrations    : ${applied.length}/${migrations.length} applied${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);

  const [users, subs, payouts, settings, tasks] = await Promise.all([
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users`),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM submissions`),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM payouts`),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM settings`),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks`),
  ]);

  console.log(
    `  rows          : ${Number(users?.c ?? 0)} wallets, ${Number(subs?.c ?? 0)} submissions, ` +
      `${Number(payouts?.c ?? 0)} payouts, ${Number(tasks?.c ?? 0)} tasks, ${Number(settings?.c ?? 0)} settings`,
  );

  if (Number(tasks?.c ?? 0) === 0) {
    console.error("\n  ✖ No task catalogue found — run the app once (or `npm run seed`) to seed defaults.\n");
    process.exit(1);
  }

  console.log(`\n  ✓ Database looks healthy.\n`);
}

main().catch((err) => {
  console.error(`\n  ✖ Database check failed: ${(err as Error).message}\n`);
  process.exit(1);
});
