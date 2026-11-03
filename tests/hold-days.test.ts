import { describe, expect, it } from "vitest";
import { countHoldDays } from "@/lib/services/holdings";
import { DAY, HOUR } from "@/lib/utils";

const MIN = 1_000_000n * 10n ** 18n;
const day = (n: number, hour = 12) =>
  Date.UTC(2026, 0, 1 + n, hour, 0, 0);

describe("holding duration counting", () => {
  it("counts distinct qualifying days", () => {
    const snapshots = [0, 1, 2].map((n) => ({
      balance_raw: MIN.toString(),
      verified_at: day(n),
    }));
    expect(countHoldDays(snapshots, MIN, 20 * HOUR)).toBe(3);
  });

  it("ignores duplicate checks inside the same day", () => {
    const snapshots = [
      { balance_raw: MIN.toString(), verified_at: day(0, 1) },
      { balance_raw: MIN.toString(), verified_at: day(0, 5) },
      { balance_raw: MIN.toString(), verified_at: day(0, 23) },
    ];
    expect(countHoldDays(snapshots, MIN, 20 * HOUR)).toBe(1);
  });

  it("enforces the minimum spacing between counted checks", () => {
    const start = day(0);
    const snapshots = [
      { balance_raw: MIN.toString(), verified_at: start },
      { balance_raw: MIN.toString(), verified_at: start + 2 * HOUR },
      { balance_raw: MIN.toString(), verified_at: start + 25 * HOUR },
    ];
    // second check is too close to count; third is a new day beyond 20h
    expect(countHoldDays(snapshots, MIN, 20 * HOUR)).toBe(2);
  });

  it("discards snapshots below the minimum balance", () => {
    const snapshots = [
      { balance_raw: (MIN - 1n).toString(), verified_at: day(0) },
      { balance_raw: MIN.toString(), verified_at: day(1) },
      { balance_raw: "0", verified_at: day(2) },
    ];
    expect(countHoldDays(snapshots, MIN, 20 * HOUR)).toBe(1);
  });

  it("tolerates malformed snapshot values", () => {
    const snapshots = [
      { balance_raw: "not-a-number", verified_at: day(0) },
      { balance_raw: MIN.toString(), verified_at: day(1) },
    ];
    expect(countHoldDays(snapshots, MIN, 20 * HOUR)).toBe(1);
  });

  it("counts consecutive daily checks as 5 days", () => {
    const snapshots = [0, 1, 2, 3, 4].map((n) => ({
      balance_raw: (MIN * 2n).toString(),
      verified_at: day(n, 9),
    }));
    expect(countHoldDays(snapshots, MIN, 20 * HOUR)).toBe(5);
  });
});

describe("time constants", () => {
  it("are millisecond based", () => {
    expect(HOUR).toBe(3_600_000);
    expect(DAY).toBe(86_400_000);
  });
});
