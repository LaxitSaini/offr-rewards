import { describe, expect, it } from "vitest";
import {
  canonicalProofUrl,
  extractTweetId,
  formatAmount,
  isAddress,
  isTxHash,
  parseAmount,
  safeEqual,
  sha256,
} from "@/lib/utils";

describe("proof canonicalisation", () => {
  it("collapses X links to the tweet id so cosmetics cannot duplicate a claim", () => {
    const a = canonicalProofUrl("https://x.com/OFFR35/status/1234567890123?s=20");
    const b = canonicalProofUrl("https://twitter.com/offr35/status/1234567890123/photo/1");
    const c = canonicalProofUrl("x.com/OFFR35/status/1234567890123");
    expect(a).toBe("x:1234567890123");
    expect(b).toBe("x:1234567890123");
    expect(c).toBe("x:1234567890123");
  });

  it("strips tracking parameters from other links", () => {
    expect(canonicalProofUrl("https://example.com/post?utm_source=x&id=9&fbclid=z")).toBe(
      "example.com/post?id=9",
    );
    expect(canonicalProofUrl("https://example.com/post/")).toBe("example.com/post");
  });

  it("normalises telegram links", () => {
    expect(canonicalProofUrl("https://t.me/OFFR77/123")).toBe("telegram/offr77/123");
  });

  it("rejects non-http protocols", () => {
    expect(() => canonicalProofUrl("javascript:alert(1)")).toThrow();
  });

  it("extracts tweet ids from raw and canonical values", () => {
    expect(extractTweetId("x:987654321")).toBe("987654321");
    expect(extractTweetId("https://x.com/a/status/555")).toBe("555");
    expect(extractTweetId("not a link")).toBeNull();
  });
});

describe("crypto and amount helpers", () => {
  it("hashes deterministically", () => {
    expect(sha256("a")).toBe(sha256("a"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("parses and formats token amounts", () => {
    expect(parseAmount("1.5", 18)).toBe(1500000000000000000n);
    expect(formatAmount(1500000000000000000n, 18)).toBe("1.5");
    expect(formatAmount(0n, 18)).toBe("0");
    expect(() => parseAmount("-1", 18)).toThrow();
    expect(() => parseAmount("1e9", 18)).toThrow();
  });

  it("validates addresses and transaction hashes", () => {
    expect(isAddress("0xee9069e8f520652e59674fad2120f6dea2671ba3")).toBe(true);
    expect(isAddress("0x123")).toBe(false);
    expect(isTxHash(`0x${"a".repeat(64)}`)).toBe(true);
    expect(isTxHash(`0x${"a".repeat(63)}`)).toBe(false);
  });
});
