/**
 * Cold-copy backup for the SQLite deployment.
 *
 *   npm run db:backup                # writes <db dir>/backups/offr-<iso>.db
 *   BACKUP_DIR=/var/data/backups npm run db:backup
 *   KEEP=30 npm run db:backup        # keep the newest 30, prune older ones
 *
 * Uses better-sqlite3's online backup API, so it is safe to run while the
 * service is serving traffic (no half-copied page cache). Postgres deployments
 * are told to use their provider's snapshots instead of pretending to handle it.
 */
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

type Database = {
  prepare: (sql: string) => { get: () => unknown };
  backup: (dest: string) => Promise<unknown>;
  close: () => void;
};

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main() {
  if (process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
    console.log(
      "This deployment uses Postgres. Take backups with your provider's snapshot/PITR feature —\n" +
        "a SQLite file copy would not contain the data.",
    );
    return;
  }

  const dbPath = resolve(process.env.SQLITE_PATH ?? "./data/offr.db");
  try {
    statSync(dbPath);
  } catch {
    fail(`No database at ${dbPath}. Nothing to back up yet.`);
  }

  let BetterSqlite3: new (path: string, opts?: unknown) => Database;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch {
    fail("better-sqlite3 is not installed. Run `npm ci --include=optional` first.");
  }

  const keep = Math.max(1, Number(process.env.KEEP ?? 14));
  const outDir = resolve(process.env.BACKUP_DIR ?? join(dirname(dbPath), "backups"));
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(outDir, `offr-${stamp}.db`);

  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }

  // Prove the copy is readable and internally consistent before trusting it.
  const copy = new BetterSqlite3(dest, { readonly: true, fileMustExist: true });
  let integrity = "unknown";
  let users = "n/a";
  try {
    const row = copy.prepare("PRAGMA integrity_check").get() as Record<string, string> | undefined;
    integrity = Object.values(row ?? {})[0] ?? "unknown";
    const count = copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n?: number } | undefined;
    users = String(count?.n ?? "n/a");
  } finally {
    copy.close();
  }

  if (integrity !== "ok") fail(`Backup at ${dest} failed integrity_check: ${integrity}`);

  const sizeKb = Math.round(statSync(dest).size / 1024);
  console.log(`✔ Backup written and verified`);
  console.log(`  file      : ${dest}`);
  console.log(`  size      : ${sizeKb} KB`);
  console.log(`  integrity : ${integrity}`);
  console.log(`  users     : ${users}`);

  const files = readdirSync(outDir)
    .filter((f) => /^offr-.*\.db$/.test(f))
    .sort()
    .reverse();
  for (const stale of files.slice(keep)) {
    rmSync(join(outDir, stale), { force: true });
    console.log(`  pruned    : ${stale}`);
  }
  console.log(`  retained  : ${Math.min(files.length, keep)} of ${keep}`);
}

main().catch((err) => fail((err as Error).message ?? "backup failed"));
