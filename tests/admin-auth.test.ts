import { beforeAll, describe, expect, it } from "vitest";
import {
  authenticateAdmin,
  createAdmin,
  findAdminByEmail,
  hashPassword,
  provisionAdminFromEnv,
  verifyPassword,
} from "@/lib/auth/admin";

beforeAll(async () => {
  await provisionAdminFromEnv();
});

describe("admin password hashing", () => {
  it("stores a scrypt hash, never the password", async () => {
    const hash = await hashPassword("correct-horse-9");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("correct-horse-9");
    expect(await verifyPassword("correct-horse-9", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects malformed hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("enforces a minimum password policy", async () => {
    await expect(createAdmin("weak@test.local", "short")).rejects.toThrow();
    await expect(createAdmin("weak@test.local", "alphabetsoup")).rejects.toThrow();
  });
});

describe("admin authentication", () => {
  it("bootstraps the first admin from environment variables", async () => {
    const admin = await findAdminByEmail("admin@test.local");
    expect(admin).not.toBeNull();
    expect(admin?.password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("authenticates with the right password and rejects the wrong one", async () => {
    const ok = await authenticateAdmin("admin@test.local", "test-password-1234");
    expect(ok.admin.email).toBe("admin@test.local");

    await expect(authenticateAdmin("admin@test.local", "nope-nope-1")).rejects.toThrow();
  });

  it("returns a generic error for unknown accounts", async () => {
    await expect(authenticateAdmin("ghost@test.local", "test-password-1234")).rejects.toThrow(
      /invalid email or password/i,
    );
  });

  it("locks the account after repeated failures", async () => {
    await createAdmin("lockme@test.local", "lockme-password-1");
    for (let i = 0; i < 5; i++) {
      await expect(authenticateAdmin("lockme@test.local", "bad-password-1")).rejects.toThrow();
    }
    await expect(authenticateAdmin("lockme@test.local", "lockme-password-1")).rejects.toThrow(
      /locked/i,
    );
  });
});
