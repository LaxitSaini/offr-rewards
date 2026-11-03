import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * Everything here is read from process.env. No secrets are hardcoded, and
 * integration flags are derived so the UI can honestly label what is active.
 *
 * Validation is deliberately fail-closed: a malformed security-relevant value
 * (team payout wallet, token decimals) refuses to start rather than silently
 * accepting every payout or mis-scaling amounts.
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

const isProd = process.env.NODE_ENV === "production";

/** Validates an EVM address or returns undefined when not provided. */
export function parseEvmAddress(raw: string | undefined, name: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const value = raw.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(
      `${name} must be a 0x-prefixed 40-hex EVM address (received ${value.length} chars). Refusing to start.`,
    );
  }
  return value.toLowerCase();
}

/** Validates ERC-20 decimals (0–36) when explicitly supplied. */
export function parseDecimals(raw: string | undefined): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > 36) {
    throw new Error("TOKEN_DECIMALS must be an integer between 0 and 36. Refusing to start.");
  }
  return value;
}

/** Clamps the admin session TTL into a sane range instead of trusting the env. */
export function parseAdminSessionHours(raw: string | undefined): number {
  if (!raw) return 8;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    console.warn("[env] ADMIN_SESSION_HOURS is not a number — falling back to 8 hours");
    return 8;
  }
  return Math.min(168, Math.max(1, value));
}

/**
 * Trusting proxy headers is opt-in, but the big hosting platforms overwrite
 * `X-Forwarded-For` themselves, so they are detected automatically. Without a
 * trustworthy header every client would look identical and share one rate-limit
 * bucket, which is a denial-of-service waiting to happen.
 */
export function parseTrustProxy(value: string | undefined, platformDetected: boolean): boolean {
  if (value !== undefined && value.trim() !== "") return value.trim() === "1";
  return platformDetected;
}

function detectProxyPlatform(): boolean {
  const e = process.env;
  return (
    e.VERCEL === "1" ||
    Boolean(e.FLY_APP_NAME) ||
    Boolean(e.RAILWAY_ENVIRONMENT) ||
    Boolean(e.RENDER) ||
    Boolean(e.DOPPLER_ENVIRONMENT)
  );
}

/**
 * Serverless hosts give every invocation its own process and a read-only or
 * ephemeral filesystem. A SQLite file there looks like it works and then loses
 * every write on the next cold start, so this flag switches the app into a
 * "Postgres or refuse" mode instead of pretending.
 */
export function detectServerless(platform: NodeJS.ProcessEnv): boolean {
  return Boolean(platform.VERCEL || platform.AWS_LAMBDA_FUNCTION_NAME || platform.NETLIFY);
}

/** Pool size per invocation. Serverless instances must stay at 1 to protect a
 * free Postgres tier's connection limit; a long-lived host can use more. */
export function resolvePgPoolMax(raw: string | undefined, serverless: boolean): number {
  const parsed = Number(raw);
  if (raw !== undefined && raw.trim() !== "" && Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(20, Math.floor(parsed));
  }
  return serverless ? 1 : 5;
}

const serverless = detectServerless(process.env);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd,
  serverless,

  appUrl: optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",

  databaseUrl: optional("DATABASE_URL"),
  sqlitePath: optional("SQLITE_PATH") ?? "./data/offr.db",
  pgPoolMax: resolvePgPoolMax(optional("PG_POOL_MAX"), serverless),

  baseRpcUrl: optional("BASE_RPC_URL") ?? "https://mainnet.base.org",
  chainMode: (optional("CHAIN_MODE") ?? "live") as "live" | "mock",
  tokenDecimalsOverride: parseDecimals(optional("TOKEN_DECIMALS")),

  telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
  telegramBotUsername: optional("TELEGRAM_BOT_USERNAME"),
  telegramChatId: optional("TELEGRAM_CHAT_ID"),
  telegramWebhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),

  xBearerToken: optional("X_BEARER_TOKEN"),
  teamWallet: parseEvmAddress(optional("TEAM_WALLET_ADDRESS"), "TEAM_WALLET_ADDRESS"),
  xHandle: optional("X_ACCOUNT_HANDLE") ?? "OFFR35",

  adminEmail: optional("ADMIN_EMAIL")?.toLowerCase(),
  adminPassword: optional("ADMIN_PASSWORD"),
  adminSessionHours: parseAdminSessionHours(optional("ADMIN_SESSION_HOURS")),

  // Opt-in on bare metal; automatic on platforms that overwrite the header.
  trustProxy: parseTrustProxy(optional("TRUST_PROXY"), detectProxyPlatform()),
  // Never allow the limiter to be disabled in production, even if the flag is set.
  rateLimitDisabled: isProd ? false : boolLike.parse(process.env.RATE_LIMIT_DISABLED),
} as const;

if (isProd && env.chainMode === "mock") {
  throw new Error(
    "CHAIN_MODE=mock is refused in production. On-chain verification must hit a real Base RPC before real token distribution.",
  );
}

if (serverless && !env.databaseUrl) {
  console.warn(
    "[env] Serverless host detected without DATABASE_URL. SQLite cannot persist here — set DATABASE_URL to a Postgres connection string (Neon/Supabase/Render) before serving traffic. See docs/DEPLOYMENT-FREE.md.",
  );
}

if (isProd && process.env.RATE_LIMIT_DISABLED) {
  console.warn("[env] RATE_LIMIT_DISABLED is ignored in production.");
}

if (isProd && env.appUrl.startsWith("http://")) {
  console.warn("[env] NEXT_PUBLIC_APP_URL is not https — session cookies are Secure-only in production.");
}

if (isProd && env.adminPassword) {
  console.warn(
    "[env] ADMIN_PASSWORD is still set in production. Rotate the admin password and remove it once the account exists; leaving it set allows re-provisioning if the admins table is ever emptied.",
  );
}

export const integrations = {
  telegramConfigured: Boolean(env.telegramBotToken && env.telegramChatId),
  telegramPartiallyConfigured: Boolean(env.telegramBotToken) !== Boolean(env.telegramChatId),
  xConfigured: Boolean(env.xBearerToken),
  chainLive: env.chainMode === "live",
  database: env.databaseUrl?.startsWith("postgres")
    ? "postgres"
    : env.serverless
      ? "none" // serverless with no DATABASE_URL: there is no database, not a SQLite one
      : "sqlite",
  teamWalletRestricted: Boolean(env.teamWallet),
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
