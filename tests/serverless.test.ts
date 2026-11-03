import { describe, expect, it } from "vitest";
import { detectServerless, resolvePgPoolMax } from "@/lib/env";

const asEnv = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
import { sanitizeDbError } from "@/lib/utils";

/**
 * Serverless / free-tier guardrails.
 *
 * The card-free deployment target is a serverless host (Vercel) or a free
 * long-lived host (Render free) in front of hosted Postgres. These tests pin the
 * two rules that keep that safe: never fall back to an ephemeral SQLite file on
 * a serverless platform, and never open a connection fan-out that exhausts a
 * free Postgres tier.
 */

describe("serverless detection", () => {
  it("recognises Vercel, Lambda and Netlify", () => {
    expect(detectServerless(asEnv({ VERCEL: "1" }))).toBe(true);
    expect(detectServerless(asEnv({ AWS_LAMBDA_FUNCTION_NAME: "fn" }))).toBe(true);
    expect(detectServerless(asEnv({ NETLIFY: "true" }))).toBe(true);
  });

  it("treats a long-lived host (Render/Fly/VM) as not serverless", () => {
    expect(detectServerless(asEnv({ RENDER: "true" }))).toBe(false);
    expect(detectServerless(asEnv({}))).toBe(false);
  });
});

describe("Postgres pool sizing", () => {
  it("uses a single connection per serverless invocation", () => {
    expect(resolvePgPoolMax(undefined, true)).toBe(1);
  });

  it("allows a small pool on a long-lived host", () => {
    expect(resolvePgPoolMax(undefined, false)).toBe(5);
  });

  it("honours an explicit PG_POOL_MAX and clamps it", () => {
    expect(resolvePgPoolMax("3", true)).toBe(3);
    expect(resolvePgPoolMax("1", false)).toBe(1);
    expect(resolvePgPoolMax("999", false)).toBe(20);
    expect(resolvePgPoolMax("0", true)).toBe(1); // invalid -> default, never 0
    expect(resolvePgPoolMax("abc", false)).toBe(5);
    expect(resolvePgPoolMax("", true)).toBe(1);
  });
});

describe("health error sanitisation", () => {
  it("keeps the reason and removes credentials", () => {
    const raw =
      "password authentication failed for user \"neondb_owner\" (postgresql://neondb_owner:s3cret@ep-x-pooler.eu-central-1.aws.neon.tech/neondb)";
    const clean = sanitizeDbError(raw);
    expect(clean).toContain("password authentication failed");
    expect(clean).not.toContain("s3cret");
    expect(clean).not.toContain("ep-x-pooler");
  });

  it("strips bare password parameters and long tokens", () => {
    const clean = sanitizeDbError(`connect failed password=hunter2 token=${"a".repeat(40)}`);
    expect(clean).not.toContain("hunter2");
    expect(clean).not.toContain("a".repeat(40));
    expect(clean).toContain("connect failed");
  });

  it("caps the message length so a stack trace cannot be echoed", () => {
    expect(sanitizeDbError("x".repeat(5000)).length).toBeLessThanOrEqual(200);
  });

  it("leaves ordinary connection errors readable", () => {
    expect(sanitizeDbError("connect ECONNREFUSED 127.0.0.1:5432")).toBe(
      "connect ECONNREFUSED 127.0.0.1:5432",
    );
    expect(sanitizeDbError("database \"neondb\" does not exist")).toBe(
      'database "neondb" does not exist',
    );
  });
});
