import { seedDefaults } from "@/lib/seed";

const globalForBoot = globalThis as unknown as { __offrBoot?: Promise<void> };

/**
 * Idempotent first-run bootstrap: creates the schema-adjacent seed data
 * (campaign settings + task catalogue). Safe to call from any route handler.
 */
export async function ensureBoot(): Promise<void> {
  if (!globalForBoot.__offrBoot) {
    globalForBoot.__offrBoot = seedDefaults().catch((err) => {
      globalForBoot.__offrBoot = undefined;
      throw err;
    });
  }
  await globalForBoot.__offrBoot;
}
