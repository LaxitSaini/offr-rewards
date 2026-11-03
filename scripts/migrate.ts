/**
 * Applies pending migrations and seeds the campaign defaults.
 * Usage: npm run db:migrate
 */
import { getDb, dialect, query } from "@/lib/db";
import { ensureBoot } from "@/lib/bootstrap";
import { env } from "@/lib/env";

async function main() {
  const db = await getDb();
  await db.execRaw("SELECT 1");
  await ensureBoot();

  const applied = await query<{ version: string; applied_at: number }>(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version",
  );
  const dbDialect = await dialect();
  const tasks = await query<{ c: number }>("SELECT COUNT(*) AS c FROM tasks");
  const users = await query<{ c: number }>("SELECT COUNT(*) AS c FROM users");

  console.log(`\n✅ Database ready (${dbDialect})`);
  console.log(`   URL: ${env.databaseUrl ? env.databaseUrl.replace(/:[^:@]+@/, ":****@") : env.sqlitePath}`);
  console.log(`   Migrations: ${applied.map((m) => m.version).join(", ") || "none"}`);
  console.log(`   Tasks: ${tasks[0]?.c ?? 0} · Participants: ${users[0]?.c ?? 0}`);
  console.log(`   Chain mode: ${env.chainMode}${env.chainMode === "mock" ? " (balances simulated)" : ""}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
