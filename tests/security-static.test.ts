import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Static security regression suite.
 *
 * These tests read the source tree instead of running it, so they catch rules
 * that are easy to break silently in a refactor: a write-capable chain call
 * sneaking in, a secret leaking to the browser bundle, an admin route losing
 * its guard, or a test credential shipping to production.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|css)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const sourceFiles = walk(SRC);
const sourceText = sourceFiles
  .map((file) => `\n/* ${relative(ROOT, file)} */\n${readFileSync(file, "utf8")}`)
  .join("\n");

function filesMatching(re: RegExp): string[] {
  return sourceFiles.filter((file) => re.test(readFileSync(file, "utf8"))).map((f) => relative(ROOT, f));
}

describe("chain integration stays read-only", () => {
  it("uses the exact Base mainnet contract and chain id", () => {
    const constants = readFileSync(join(SRC, "lib/constants.ts"), "utf8");
    expect(constants).toContain("0xee9069e8f520652e59674fad2120f6dea2671ba3");
    expect(constants).toContain("chainId: 8453");
  });

  it("never signs or sends a transaction", () => {
    expect(filesMatching(/\b(writeContract|sendTransaction|sendRawTransaction|signTransaction)\b/)).toEqual([]);
  });

  it("never holds a private key or mnemonic", () => {
    expect(filesMatching(/\b(privateKeyToAccount|mnemonicToAccount|PRIVATE_KEY|MNEMONIC)\b/)).toEqual([]);
  });

  it("reads token decimals from the contract and fails closed", () => {
    const source = readFileSync(join(SRC, "lib/chain/index.ts"), "utf8");
    expect(source).toMatch(/decimals/);
    // A hardcoded fallback would silently misprice rewards if decimals changed.
    expect(source).not.toMatch(/decimals\s*\?\?\s*18/);
  });
});

describe("no secrets can reach the client", () => {
  it("has no NEXT_PUBLIC_ variable that looks secret", () => {
    const offenders = [...sourceText.matchAll(/NEXT_PUBLIC_([A-Z0-9_]+)/g)]
      .map((m) => m[0])
      .filter((name) => /(SECRET|PRIVATE|TOKEN|API_KEY|BOT|PASSWORD|DATABASE|WEBHOOK)/.test(name));
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("contains no literal credentials", () => {
    expect(filesMatching(/-----BEGIN [A-Z ]*PRIVATE KEY-----/)).toEqual([]);
    expect(filesMatching(/\bsk_(live|test)_[A-Za-z0-9]{10,}/)).toEqual([]);
    expect(filesMatching(/\bxox[baprs]-[A-Za-z0-9-]{10,}/)).toEqual([]);
    expect(filesMatching(/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/)).toEqual([]);
  });

  it("never logs an environment value", () => {
    expect(filesMatching(/console\.(log|info|warn|error)\([^)]*process\.env/)).toEqual([]);
  });

  it("keeps the health endpoint free of secrets and connection strings", () => {
    const health = readFileSync(join(SRC, "app/api/health/route.ts"), "utf8");
    expect(health).not.toMatch(/DATABASE_URL|postgres:\/\/|file:.*\.db/);
    expect(health).not.toMatch(/bot\d+:/i);
    expect(health).not.toMatch(/api[_-]?key/i);
  });
});

describe("admin surface is guarded", () => {
  const adminRoutes = walk(join(SRC, "app/api/admin")).filter((f) => f.endsWith("route.ts"));
  const publicRoutes = new Set(["login", "session", "logout"]);

  it("finds the admin route handlers", () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(14);
  });

  it("every protected admin handler calls requireAdmin", () => {
    const unguarded = adminRoutes
      .filter((file) => !publicRoutes.has(file.split("/api/admin/")[1]?.split("/")[0] ?? ""))
      .filter((file) => !readFileSync(file, "utf8").includes("requireAdmin"))
      .map((file) => relative(ROOT, file));
    expect(unguarded).toEqual([]);
  });

  it("every admin mutation calls requireCsrf", () => {
    // /api/admin/login is the CSRF bootstrap: it has no session yet and only
    // accepts a JSON body, which a cross-site form cannot send.
    const unguarded = adminRoutes
      .filter((file) => !file.endsWith("/api/admin/login/route.ts"))
      .filter((file) => {
        const body = readFileSync(file, "utf8");
        const mutates = /export const (POST|PATCH|PUT|DELETE)\b/.test(body);
        return mutates && !body.includes("requireCsrf");
      })
      .map((file) => relative(ROOT, file));
    expect(unguarded).toEqual([]);
  });

  it("keeps admin pages behind a server-side session check", () => {
    const layout = readFileSync(join(SRC, "app/admin/layout.tsx"), "utf8");
    expect(layout).toMatch(/getCurrentAdmin/);
    expect(layout).toMatch(/redirect\(/);
  });

  it("blocks anonymous admin API calls in middleware as defence in depth", () => {
    const middleware = readFileSync(join(SRC, "middleware.ts"), "utf8");
    expect(middleware).toMatch(/\/api\/admin/);
    expect(middleware).toMatch(/offr_admin/);
  });
});

describe("production safety rails", () => {
  it("fails closed when token decimals cannot be read on-chain", () => {
    const chain = readFileSync(join(SRC, "lib/chain/index.ts"), "utf8");
    expect(chain).toMatch(/meta\.source === "fallback"/);
    expect(chain).toMatch(/tokenDecimalsOverride/);
  });

  it("refuses mock chain mode in production", () => {
    expect(sourceText).toMatch(/CHAIN_MODE[\s\S]{0,400}production/i);
  });

  it("has no test payout or debug route", () => {
    const api = walk(join(SRC, "app/api")).map((f) => relative(ROOT, f).toLowerCase());
    expect(api.filter((f) => /(test|debug|dev-only|_mock)/.test(f))).toEqual([]);
  });

  it("never commits env files, databases or proof data", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const leaks = tracked.filter(
      (f) => /(^|\/)\.env($|\.)|\.db$|\.sqlite$|^data\//.test(f) && !f.endsWith(".env.example"),
    );
    expect(leaks).toEqual([]);
  });

  it("has no default or demo admin password in source", () => {
    expect(sourceText).not.toMatch(/password["']?\s*[:=]\s*["'](admin|password|changeme|123456)/i);
  });
});
