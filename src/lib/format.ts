/**
 * Client-safe formatting helpers. This module must not import node builtins —
 * it is bundled into the browser.
 */

export function shortAddress(address?: string | null, chars = 4): string {
  if (!address) return "";
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function formatDate(ts?: number | null): string {
  if (!ts) return "—";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(ts?: number | null): string {
  if (!ts) return "—";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** ISO date string for <input type="date">. */
export function toDateInputValue(ts?: number | null): string {
  if (!ts) return "";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function fromDateInputValue(value: string): number {
  const parsed = new Date(`${value}T00:00:00.000Z`).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Removes trailing zeros from a decimal string without touching integers. */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}
