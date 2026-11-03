import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    env: {
      CHAIN_MODE: "mock",
      SQLITE_PATH: "./data/test.db",
      RATE_LIMIT_DISABLED: "1",
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_PASSWORD: "test-password-1234",
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20000,
  },
});
