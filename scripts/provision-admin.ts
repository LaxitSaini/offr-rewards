/**
 * Creates (or rotates the password of) an admin account.
 *
 * Usage:
 *   npm run admin:hash -- --email team@offr.xyz --password 'long-unique-password'
 *   ADMIN_EMAIL=team@offr.xyz ADMIN_PASSWORD='...' npm run admin:hash
 *
 * The plaintext password is never stored — only a scrypt hash.
 */
import { ensureBoot } from "@/lib/bootstrap";
import { createAdmin, findAdminByEmail, updateAdminPassword, assertPasswordStrength } from "@/lib/auth/admin";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

async function main() {
  await ensureBoot();
  const email = (arg("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = arg("password") ?? process.env.ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    console.error(
      "❌ Provide --email and --password (or ADMIN_EMAIL / ADMIN_PASSWORD environment variables).",
    );
    process.exit(1);
  }
  assertPasswordStrength(password);

  const existing = await findAdminByEmail(email);
  if (existing) {
    await updateAdminPassword(existing.id, password);
    console.log(`✅ Password rotated for admin ${email}`);
  } else {
    await createAdmin(email, password);
    console.log(`✅ Admin created: ${email}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Admin provisioning failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
