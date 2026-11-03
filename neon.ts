import { defineConfig } from "@neon/config/v1";

/**
 * Neon services for OFFR Rewards.
 *
 * The project (`noisy-dust-30837924`, org `org-red-wave-71490138`, branch
 * `production`) already hosts the database this app talks to; `neon deploy`
 * reconciles the declarations below with what is live and writes the connection
 * strings into `.env.local`:
 *
 *   DATABASE_URL            pooled     (PgBouncer) — what the app connects with
 *   DATABASE_URL_UNPOOLED   direct                — used only for migrations
 *
 * `src/lib/env.ts` reads exactly those two names, so no renaming is needed.
 */
export default defineConfig({
  // The app ships its own email/password + wallet-signature auth; do not provision
  // Neon Auth or the Data API (both would be extra services to pay attention to).
  auth: false,
  dataApi: false,

  // Postgres itself needs no declaration: the project already hosts the database
  // and `neon deploy` injects its connection strings. Per-branch compute tuning
  // (e.g. `{ postgres: { computeSettings: { suspendTimeout: "5m" } } }`) belongs
  // inside the branch policy below, not at the top level.

  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
