import { describe, expect, it } from "vitest";
import {
  IntegrationUnavailable,
  parseTrustProxy,
  env,
  integrations,
  parseAdminSessionHours,
  parseMigrationUrl,
  parseDecimals,
  parseEvmAddress,
  requireIntegration,
} from "@/lib/env";
import { getClientIp } from "@/lib/http";

describe("database connection strategy", () => {
  // Neon exposes a pooled URL for queries and a direct URL for schema changes.
  const pooled = "postgresql://u:p@ep-x-pooler.aws.neon.tech/offr?sslmode=require";
  const direct = "postgresql://u:p@ep-x.aws.neon.tech/offr?sslmode=require";

  it("migrates over the direct URL when the host provides one", () => {
    expect(parseMigrationUrl(pooled, direct)).toBe(direct);
  });

  it("falls back to the pooled connection when no direct URL is set", () => {
    expect(parseMigrationUrl(pooled, undefined)).toBeNull();
    expect(parseMigrationUrl(undefined, direct)).toBeNull();
  });

  it("ignores a direct URL that is really the pooled one", () => {
    expect(parseMigrationUrl(pooled, pooled)).toBeNull();
  });
});

describe("env validation", () => {
  it("accepts a well-formed EVM address and lowercases it", () => {
    expect(parseEvmAddress("0xABCDEF0123456789abcdef0123456789ABCDEF01", "X")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("refuses malformed payout addresses instead of failing every payout later", () => {
    expect(() => parseEvmAddress("0x1234", "TEAM_WALLET_ADDRESS")).toThrow(/EVM address/);
    expect(() => parseEvmAddress("not-an-address", "TEAM_WALLET_ADDRESS")).toThrow(/EVM address/);
    expect(parseEvmAddress(undefined, "TEAM_WALLET_ADDRESS")).toBeUndefined();
    expect(parseEvmAddress("   ", "TEAM_WALLET_ADDRESS")).toBeUndefined();
  });

  it("bounds token decimals", () => {
    expect(parseDecimals("18")).toBe(18);
    expect(parseDecimals("6")).toBe(6);
    expect(parseDecimals("0")).toBe(0);
    expect(() => parseDecimals("18.5")).toThrow(/TOKEN_DECIMALS/);
    expect(() => parseDecimals("-1")).toThrow(/TOKEN_DECIMALS/);
    expect(() => parseDecimals("99")).toThrow(/TOKEN_DECIMALS/);
    expect(parseDecimals(undefined)).toBeUndefined();
  });

  it("clamps the admin session TTL", () => {
    expect(parseAdminSessionHours("8")).toBe(8);
    expect(parseAdminSessionHours("0")).toBe(1);
    expect(parseAdminSessionHours("10000")).toBe(168);
    expect(parseAdminSessionHours("abc")).toBe(8);
    expect(parseAdminSessionHours(undefined)).toBe(8);
  });

  it("derives integration flags from what is actually configured", () => {
    expect(integrations.chainLive).toBe(false); // tests run with CHAIN_MODE=mock
    expect(integrations.database).toBe("sqlite");
    expect(integrations.teamWalletRestricted).toBe(false);
  });

  it("reports missing credentials as an explicit, typed error", () => {
    expect(() => requireIntegration("x")).toThrow(IntegrationUnavailable);
  });
});

describe("proxy header trust", () => {
  it("is opt-in on bare metal and automatic on known platforms", () => {
    expect(parseTrustProxy(undefined, false)).toBe(false);
    expect(parseTrustProxy(undefined, true)).toBe(true);
    expect(parseTrustProxy("0", true)).toBe(false); // explicit opt-out wins
    expect(parseTrustProxy("1", false)).toBe(true);
    expect(parseTrustProxy("", false)).toBe(false);
  });

  it("ignores X-Forwarded-For unless TRUST_PROXY=1 (rate-limit spoofing guard)", () => {
    expect(env.trustProxy).toBe(false);
    const req = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "9.9.9.9", "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("direct");
  });
});
