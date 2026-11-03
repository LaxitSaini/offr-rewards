import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * Everything here is read from process.env. No secrets are hardcoded, and
 * integration flags are derived so the UI can honestly label what is active.
 */

function optional(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const boolLike = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true" || v === "yes");

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",

  appUrl: optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",

  databaseUrl: optional("DATABASE_URL"),
  sqlitePath: optional("SQLITE_PATH") ?? "./data/offr.db",

  baseRpcUrl: optional("BASE_RPC_URL") ?? "https://mainnet.base.org",
  chainMode: (optional("CHAIN_MODE") ?? "live") as "live" | "mock",
  tokenDecimalsOverride: optional("TOKEN_DECIMALS")
    ? Number(optional("TOKEN_DECIMALS"))
    : undefined,

  telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
  telegramBotUsername: optional("TELEGRAM_BOT_USERNAME"),
  telegramChatId: optional("TELEGRAM_CHAT_ID"),
  telegramWebhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),

  xBearerToken: optional("X_BEARER_TOKEN"),
  teamWallet: optional("TEAM_WALLET_ADDRESS")?.toLowerCase(),
  xHandle: optional("X_ACCOUNT_HANDLE") ?? "OFFR35",

  adminEmail: optional("ADMIN_EMAIL")?.toLowerCase(),
  adminPassword: optional("ADMIN_PASSWORD"),
  adminSessionHours: Number(optional("ADMIN_SESSION_HOURS") ?? "8"),

  trustProxy: optional("TRUST_PROXY") !== "0",
  rateLimitDisabled: boolLike.parse(process.env.RATE_LIMIT_DISABLED),
} as const;

if (env.isProd && env.chainMode === "mock") {
  throw new Error(
    "CHAIN_MODE=mock is refused in production. On-chain verification must hit a real Base RPC before real token distribution.",
  );
}

export const integrations = {
  telegramConfigured: Boolean(env.telegramBotToken && env.telegramChatId),
  telegramPartiallyConfigured: Boolean(env.telegramBotToken) !== Boolean(env.telegramChatId),
  xConfigured: Boolean(env.xBearerToken),
  chainLive: env.chainMode === "live",
  database: env.databaseUrl?.startsWith("postgres") ? "postgres" : "sqlite",
} as const;

export function requireIntegration(name: "telegram" | "x"): void {
  if (name === "telegram" && !integrations.telegramConfigured) {
    throw new IntegrationUnavailable(
      "Telegram verification is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
    );
  }
  if (name === "x" && !integrations.xConfigured) {
    throw new IntegrationUnavailable(
      "X post verification is not configured. Set X_BEARER_TOKEN to enable API checks.",
    );
  }
}

export class IntegrationUnavailable extends Error {
  code = "integration_unavailable" as const;
  constructor(message: string) {
    super(message);
    this.name = "IntegrationUnavailable";
  }
}
