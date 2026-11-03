import { execute, newId, queryOne } from "@/lib/db";
import { errors } from "@/lib/http";
import { CHAIN_ID, OFFR } from "@/lib/constants";
import { MINUTE, normalizeWallet, now, randomToken, safeEqual } from "@/lib/utils";

export const NONCE_TTL_MS = 10 * MINUTE;

export interface NoncePurpose {
  purpose: "session";
  wallet: string;
}

/**
 * Builds the exact message the wallet is asked to sign. The message is persisted
 * and re-verified byte-for-byte on the server, which makes replay impossible.
 */
export function buildSignInMessage(args: {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  uri: string;
}): string {
  const { domain, address, nonce, issuedAt, expiresAt, uri } = args;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to OFFR Rewards. This signature proves wallet ownership and will not trigger a transaction or cost gas.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    `Resources:`,
    `- ${OFFR.xUrl}`,
    `- ${OFFR.telegramUrl}`,
  ].join("\n");
}

export async function createNonce(args: {
  wallet: string;
  domain: string;
  uri: string;
}): Promise<{ nonce: string; message: string; expiresAt: number }> {
  const wallet = normalizeWallet(args.wallet);
  const nonce = newId().replace(/[^a-z0-9]/gi, "").slice(0, 16);
  const issuedAt = now();
  const expiresAt = issuedAt + NONCE_TTL_MS;
  const message = buildSignInMessage({
    domain: args.domain,
    address: wallet,
    nonce,
    issuedAt,
    expiresAt,
    uri: args.uri,
  });

  await execute(
    `INSERT INTO auth_nonces (nonce, wallet, purpose, message, created_at, expires_at, used_at)
     VALUES (?, ?, 'session', ?, ?, ?, NULL)`,
    [nonce, wallet, message, issuedAt, expiresAt],
  );
  return { nonce, message, expiresAt };
}

export async function consumeNonce(wallet: string): Promise<{ message: string; nonce: string }> {
  const normalized = normalizeWallet(wallet);
  const row = await queryOne<{
    nonce: string;
    message: string;
    expires_at: number;
    used_at: number | null;
  }>(
    `SELECT nonce, message, expires_at, used_at FROM auth_nonces
     WHERE wallet = ? AND purpose = 'session' AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [normalized],
  );
  if (!row) {
    throw errors.badRequest("Sign-in request expired. Request a new signature.");
  }
  if (Number(row.expires_at) < now()) {
    throw errors.badRequest("Sign-in signature expired. Please sign again.");
  }
  const consumed = await execute(
    `UPDATE auth_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL`,
    [now(), row.nonce],
  );
  if (consumed.changes === 0) {
    throw errors.conflict("This signature was already used. Please sign again.");
  }
  return { message: row.message, nonce: row.nonce };
}

export function assertNonceMatches(storedNonce: string, claimed?: string): void {
  if (claimed && !safeEqual(storedNonce, claimed)) {
    throw errors.badRequest("Nonce mismatch.");
  }
}

export function randomSessionToken(): string {
  return randomToken(32);
}
