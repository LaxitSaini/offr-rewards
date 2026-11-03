import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { execute, newId, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { errors } from "@/lib/http";
import type { AdminRow } from "@/lib/auth/session";
import { MINUTE, now } from "@/lib/utils";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * MINUTE;

export const PASSWORD_MIN_LENGTH = 12;

export function assertPasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw errors.badRequest(`Admin passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw errors.badRequest("Admin password must contain letters and numbers.");
  }
}

/** Hashes with scrypt; format: scrypt$N$r$p$saltHex$hashHex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const derived = await scrypt(password, Buffer.from(saltHex, "hex"), hashHex.length / 2, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export async function countAdmins(): Promise<number> {
  const row = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM admins`);
  return Number(row?.c ?? 0);
}

export async function findAdminByEmail(email: string): Promise<AdminRow | null> {
  return queryOne<AdminRow>(`SELECT * FROM admins WHERE email = ?`, [email.trim().toLowerCase()]);
}

/**
 * Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when the admins
 * table is empty. The plaintext env var is never stored — only the scrypt hash.
 */
export async function provisionAdminFromEnv(): Promise<{ created: boolean; email?: string }> {
  if ((await countAdmins()) > 0) return { created: false };
  if (!env.adminEmail || !env.adminPassword) return { created: false };
  try {
    assertPasswordStrength(env.adminPassword);
  } catch {
    console.error("[admin] ADMIN_PASSWORD does not meet policy; admin bootstrap skipped");
    return { created: false };
  }
  await execute(
    `INSERT INTO admins (id, email, password_hash, is_active, failed_attempts, locked_until, created_at, last_login_at)
     VALUES (?, ?, ?, 1, 0, NULL, ?, NULL)
     ON CONFLICT (email) DO NOTHING`,
    [newId("adm"), env.adminEmail, await hashPassword(env.adminPassword), now()],
  );
  console.info(`[admin] provisioned admin account ${env.adminEmail}`);
  return { created: true, email: env.adminEmail };
}

export async function createAdmin(email: string, password: string): Promise<string> {
  assertPasswordStrength(password);
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw errors.badRequest("Enter a valid admin email address.");
  }
  const existing = await findAdminByEmail(normalized);
  if (existing) throw errors.conflict("An admin with that email already exists.");
  const id = newId("adm");
  await execute(
    `INSERT INTO admins (id, email, password_hash, is_active, failed_attempts, locked_until, created_at, last_login_at)
     VALUES (?, ?, ?, 1, 0, NULL, ?, NULL)`,
    [id, normalized, await hashPassword(password), now()],
  );
  return id;
}

export async function updateAdminPassword(adminId: string, password: string): Promise<void> {
  assertPasswordStrength(password);
  await execute(`UPDATE admins SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?`, [
    await hashPassword(password),
    adminId,
  ]);
}

export interface LoginResult {
  admin: AdminRow;
}

/**
 * Authenticates an admin. Error messages are deliberately generic so the
 * endpoint cannot be used to enumerate admin accounts.
 */
export async function authenticateAdmin(email: string, password: string): Promise<LoginResult> {
  await provisionAdminFromEnv();
  const admin = await findAdminByEmail(email);
  const generic = errors.unauthorized("Invalid email or password.");

  if (!admin) {
    // Constant-ish work factor to avoid a timing oracle on account existence.
    await hashPassword(password);
    throw generic;
  }
  if (!admin.is_active) throw generic;
  if (admin.locked_until && Number(admin.locked_until) > now()) {
    throw errors.tooMany(
      Math.ceil((Number(admin.locked_until) - now()) / 1000),
      "This admin account is temporarily locked. Try again later.",
    );
  }

  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) {
    const attempts = Number(admin.failed_attempts) + 1;
    await execute(
      `UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?`,
      [attempts, attempts >= MAX_FAILED_ATTEMPTS ? now() + LOCKOUT_MS : null, admin.id],
    );
    throw generic;
  }

  await execute(`UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`, [
    now(),
    admin.id,
  ]);
  return { admin };
}
