import { describe, expect, it } from "vitest";
import {
  budgetSnapshot,
  computeReward,
  decimalCmp,
  mulPoints,
  subDecimal,
  addDecimal,
} from "@/lib/services/rewards";

const baseSettings = {
  offrPerPoint: "10",
  minPointsForReward: 50,
  maxRewardPerUserOffr: "250000",
  budgetOffr: "10000000",
  requireHoldForReward: false,
};

const baseInput = {
  points: 500,
  blocked: false,
  holdRequirementMet: true,
  settings: baseSettings,
  userPaidOffr: "0",
  totalPaidOffr: "0",
};

describe("reward maths", () => {
  it("converts points to OFFR without floating point drift", () => {
    expect(mulPoints(500, "10")).toBe("5000");
    expect(mulPoints(3, "0.1")).toBe("0.3");
    expect(mulPoints(7, "12.5")).toBe("87.5");
    expect(mulPoints(0, "10")).toBe("0");
  });

  it("adds and subtracts decimals exactly", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(subDecimal("10", "0.000001")).toBe("9.999999");
    expect(subDecimal("1", "5")).toBe("0");
    expect(decimalCmp("100", "100.0")).toBe(0);
  });

  it("marks low-point wallets as ineligible", () => {
    const result = computeReward({ ...baseInput, points: 10 });
    expect(result.eligible).toBe(false);
    expect(result.cappedBy).toBe("below_min_points");
  });

  it("computes a normal eligible reward", () => {
    const result = computeReward(baseInput);
    expect(result.eligible).toBe(true);
    expect(result.netOffr).toBe("5000");
    expect(result.cappedBy).toBe("none");
  });

  it("caps by the per-user limit, accounting for earlier payouts", () => {
    const result = computeReward({
      ...baseInput,
      points: 100000,
      userPaidOffr: "200000",
      settings: { ...baseSettings, maxRewardPerUserOffr: "250000" },
    });
    expect(result.eligible).toBe(true);
    expect(result.netOffr).toBe("50000");
    expect(result.cappedBy).toBe("user_cap");
  });

  it("blocks users who already hit their cap", () => {
    const result = computeReward({
      ...baseInput,
      userPaidOffr: "250000",
    });
    expect(result.eligible).toBe(false);
    expect(result.cappedBy).toBe("cap_reached");
  });

  it("caps by remaining campaign budget", () => {
    const result = computeReward({
      ...baseInput,
      points: 500,
      settings: { ...baseSettings, budgetOffr: "1000" },
      totalPaidOffr: "700",
    });
    expect(result.eligible).toBe(true);
    expect(result.netOffr).toBe("300");
    expect(result.cappedBy).toBe("budget_exhausted");
  });

  it("refuses rewards when the budget is exhausted", () => {
    const result = computeReward({
      ...baseInput,
      settings: { ...baseSettings, budgetOffr: "1000" },
      totalPaidOffr: "1000",
    });
    expect(result.eligible).toBe(false);
    expect(result.cappedBy).toBe("budget_exhausted");
  });

  it("honours a holding requirement", () => {
    const result = computeReward({
      ...baseInput,
      holdRequirementMet: false,
      settings: { ...baseSettings, requireHoldForReward: true },
    });
    expect(result.eligible).toBe(false);
    expect(result.cappedBy).toBe("hold_requirement");
  });

  it("blocks restricted wallets", () => {
    const result = computeReward({ ...baseInput, blocked: true });
    expect(result.eligible).toBe(false);
    expect(result.cappedBy).toBe("blocked");
  });

  it("reports budget utilisation", () => {
    const snapshot = budgetSnapshot("10000000", "2500000");
    expect(snapshot.remainingOffr).toBe("7500000");
    expect(snapshot.utilisationPct).toBe(25);
  });
});
