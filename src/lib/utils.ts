import crypto from "node:crypto";
import { formatUnits, parseUnits } from "viem";
import { shortAddress, formatDate, truncate, clamp } from "@/lib/format";

export { shortAddress, formatDate, truncate, clamp };

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function now(): number {
  return Date.now();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Constant-time byte comparison (returns false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function isTxHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function normalizeWallet(address: string): string {
  return address.trim().toLowerCase();
}

/** Parse a human decimal amount without floating point drift. */
export function parseAmount(value: string, decimals: number): bigint {
  const clean = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error(`Invalid amount: ${value}`);
  return parseUnits(clean, decimals);
}

export function formatAmount(raw: bigint | string, decimals: number, maxFraction = 4): string {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const full = formatUnits(value, decimals);
  const [whole, frac = ""] = full.split(".");
  const trimmed = frac.slice(0, maxFraction).replace(/0+$/, "");
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${withSeparators}.${trimmed}` : withSeparators;
}

export function compareDecimal(a: string, b: string): number {
  const [ai, af = ""] = String(a).split(".");
  const [bi, bf = ""] = String(b).split(".");
  const aiN = BigInt(ai || "0");
  const biN = BigInt(bi || "0");
  if (aiN !== biN) return aiN > biN ? 1 : -1;
  const len = Math.max(af.length, bf.length);
  const afN = BigInt((af + "0".repeat(len)).slice(0, len) || "0");
  const bfN = BigInt((bf + "0".repeat(len)).slice(0, len) || "0");
  return afN === bfN ? 0 : afN > bfN ? 1 : -1;
}

/**
 * Canonicalises a proof URL so the same content cannot be submitted twice with
 * cosmetic changes. X/Twitter links collapse to the tweet id.
 */
export function canonicalProofUrl(input: string): string {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new Error("That link does not look like a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http(s) links are accepted.");
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");

  if (["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"].includes(host)) {
    const match = path.match(/^\/(?:#!\/)?([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
    if (match) return `x:${match[2].toLowerCase()}`;
    return `x.com${path.toLowerCase()}`;
  }
  if (host === "t.me" || host === "telegram.me") return `telegram${path.toLowerCase()}`;

  // strip tracking noise so the same post cannot be re-submitted with new params
  const exactTracking = new Set(["fbclid", "gclid", "ref", "ref_src", "s", "t", "igshid", "mc_cid", "mc_eid"]);
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !/^utm_/i.test(k) && !exactTracking.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${host}${path}${query}`;
}

/** Extracts an X/Twitter status id from a canonical proof value or raw URL. */
export function extractTweetId(value: string): string | null {
  if (/^x:\d+$/.test(value)) return value.slice(2);
  const direct = value.match(/(?:x\.com|twitter\.com)\/[^/]+\/status(?:es)?\/(\d+)/i);
  if (direct) return direct[1];
  if (/^\d{8,25}$/.test(value.trim())) return value.trim();
  return null;
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

