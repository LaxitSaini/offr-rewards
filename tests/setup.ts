import fs from "node:fs";
import path from "node:path";

// Fresh SQLite file per test run so assertions are deterministic.
const file = process.env.SQLITE_PATH ?? "./data/test.db";
const resolved = path.resolve(file);
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    if (fs.existsSync(resolved + suffix)) fs.unlinkSync(resolved + suffix);
  } catch {
    /* ignore */
  }
}
