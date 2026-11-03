/**
 * Test-only preload: back the application with an in-process Postgres engine
 * (PGlite) instead of a network socket.
 *
 * Why: this sandbox cannot reach Neon, and no Postgres server is installed. To
 * still prove the *application* — not just the SQL — works on Postgres, this
 * preload installs a Postgres-backed adapter into the app's own adapter slot
 * (`globalThis.__offrDb`) before Next loads any route:
 *
 *   DATABASE_URL="postgres://pglite@localhost:5432/offr" \
 *   NODE_OPTIONS="--require $PWD/scripts/pglite-preload.cjs" npm run dev
 *
 * The SQL, the migrations, the services and the HTTP handlers are the real ones;
 * only the transport is replaced. It is not application code, is never imported
 * by the app, and refuses to run when NODE_ENV=production.
 */
// Two independent switches must be on: this file is never imported by the app,
// and a production deployment would have to set both NODE_OPTIONS and
// PGLITE_TEST=1 to reach it. Refuse otherwise so it can never silently replace
// a real database.
if (process.env.NODE_ENV === "production" && process.env.PGLITE_TEST !== "1") {
  throw new Error(
    "scripts/pglite-preload.cjs is a test harness. Set PGLITE_TEST=1 to use it deliberately with a production build.",
  );
}

// Idempotent: Next may evaluate this preload more than once per process.
if (globalThis.__offrDb) return;

/** `?` -> `$n`, skipping quoted literals. Mirrors src/lib/db/index.ts. */
function toPgPlaceholders(sql) {
  let out = "";
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (const ch of sql) {
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

/** PGlite returns JS BigInt for int8; the `postgres` driver returns a string. */
function normalizeRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === "bigint" ? value.toString() : value;
    }
    return out;
  });
}

function normalizeParams(params = []) {
  return params.map((p) => (p === undefined ? null : p));
}

// PGlite is single-connection, so every statement and transaction takes a turn.
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function buildAdapter(engine, locked) {
  const guard = (fn) => (locked ? (...args) => withLock(() => fn(...args)) : fn);

  const query = (text, params) => engine.query(toPgPlaceholders(text), normalizeParams(params));

  const all = async (text, params) => normalizeRows((await query(text, params)).rows);
  const get = async (text, params) => (await all(text, params))[0] ?? null;
  const run = async (text, params) => ({ changes: (await query(text, params)).affectedRows ?? 0 });

  return {
    dialect: "postgres",
    all: guard(all),
    get: guard(get),
    run: guard(run),
    execRaw: guard(async (text) => {
      await engine.exec(text);
    }),
    transaction: guard(async (fn) => {
      await engine.exec("BEGIN");
      try {
        const result = await fn(buildAdapter(engine, false));
        await engine.exec("COMMIT");
        return result;
      } catch (err) {
        await engine.exec("ROLLBACK").catch(() => undefined);
        throw err;
      }
    }),
  };
}

const globals = globalThis;
globals.__offrDb = (async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const engine = process.env.PGLITE_DATA
    ? await PGlite.create(process.env.PGLITE_DATA)
    : await PGlite.create();
  console.log(
    `[pglite-preload] Postgres engine ready (${process.env.PGLITE_DATA ?? "in-memory"}); app adapter injected`,
  );
  return buildAdapter(engine, true);
})();
globals.__offrMigrated = undefined;
