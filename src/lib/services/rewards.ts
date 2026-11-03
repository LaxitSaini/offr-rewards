import { parseUnits, formatUnits } from "viem";
import { trimDecimal } from "@/lib/format";
import type { CampaignSettings } from "@/lib/settings";

/**
 * Pure reward maths. All amounts are handled as integer scaled BigInts so no
 * floating point rounding can ever create or destroy tokens.
 */

const SCALE = 6n;

export function toScaled(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) return 0n;
  return parseUnits(value, Number(SCALE));
}

export function fromScaled(value: bigint): string {
  return trimDecimal(formatUnits(value, Number(SCALE)));
}

export function mulPoints(points: number, offrPerPoint: string): string {
  // Both operands already share the 1e6 scale, so the product keeps that scale.
  const scaled = toScaled(offrPerPoint) * BigInt(Math.max(0, Math.round(points)));
  return fromScaled(scaled);
}

export function minDecimal(a: string, b: string): string {
  return toScaled(a) <= toScaled(b) ? a : b;
}

export function addDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subDecimal(a: string, b: string): string {
  const diff = toScaled(a) - toScaled(b);
  return diff > 0n ? fromScaled(diff) : "0";
}

export function decimalCmp(a: string, b: string): number {
  const av = toScaled(a);
  const bv = toScaled(b);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

export type RewardCap =
  | "none"
  | "blocked"
  | "below_min_points"
  | "hold_requirement"
  | "user_cap"
  | "budget_exhausted"
  | "cap_reached";

export interface RewardComputation {
  eligible: boolean;
  points: number;
  grossOffr: string;
  netOffr: string;
  cappedBy: RewardCap;
  reasons: string[];
  remainingUserCapOffr: string;
  remainingBudgetOffr: string;
}

export interface RewardInput {
  points: number;
  blocked: boolean;
  holdRequirementMet: boolean;
  settings: Pick<
    CampaignSettings,
    | "offrPerPoint"
    | "minPointsForReward"
    | "maxRewardPerUserOffr"
    | "budgetOffr"
    | "requireHoldForReward"
  >;
  userPaidOffr: string;
  totalPaidOffr: string;
}

export function computeReward(input: RewardInput): RewardComputation {
  const { points, settings } = input;
  const grossOffr = mulPoints(points, settings.offrPerPoint);
  const remainingUserCapOffr = subDecimal(settings.maxRewardPerUserOffr, input.userPaidOffr);
  const remainingBudgetOffr = subDecimal(settings.budgetOffr, input.totalPaidOffr);

  const base: RewardComputation = {
    eligible: false,
    points,
    grossOffr,
    netOffr: "0",
    cappedBy: "none",
    reasons: [],
    remainingUserCapOffr,
    remainingBudgetOffr,
  };

  if (input.blocked) {
    return { ...base, cappedBy: "blocked", reasons: ["This wallet is blocked from rewards."] };
  }
  if (points < settings.minPointsForReward) {
    return {
      ...base,
      cappedBy: "below_min_points",
      reasons: [
        `You need at least ${settings.minPointsForReward} points to qualify. ${points} recorded so far.`,
      ],
    };
  }
  if (settings.requireHoldForReward && !input.holdRequirementMet) {
    return {
      ...base,
      cappedBy: "hold_requirement",
      reasons: ["The campaign requires a verified OFFR holding to unlock rewards."],
    };
  }
  if (decimalCmp(remainingUserCapOffr, "0") <= 0) {
    return {
      ...base,
      cappedBy: "cap_reached",
      reasons: ["You have reached the maximum reward per participant."],
    };
  }
  if (decimalCmp(remainingBudgetOffr, "0") <= 0) {
    return {
      ...base,
      cappedBy: "budget_exhausted",
      reasons: ["The campaign reward budget has been fully allocated."],
      remainingBudgetOffr: "0",
    };
  }

  let net = grossOffr;
  let cappedBy: RewardCap = "none";
  const reasons: string[] = [];

  if (decimalCmp(net, remainingUserCapOffr) > 0) {
    net = remainingUserCapOffr;
    cappedBy = "user_cap";
    reasons.push("Capped at the maximum reward per participant.");
  }
  if (decimalCmp(net, remainingBudgetOffr) > 0) {
    net = remainingBudgetOffr;
    cappedBy = "budget_exhausted";
    reasons.push("Capped by the remaining campaign budget.");
  }

  if (decimalCmp(net, "0") <= 0) {
    return { ...base, cappedBy: "cap_reached", reasons: ["No reward amount remains."] };
  }

  return {
    eligible: true,
    points,
    grossOffr,
    netOffr: net,
    cappedBy,
    reasons:
      cappedBy === "none"
        ? ["Estimate only — every payout is reviewed and approved by the team."]
        : reasons,
    remainingUserCapOffr,
    remainingBudgetOffr,
  };
}

/** Splits points across task weights for the admin preview table. */
export function pointsAtWeight(basePoints: number, weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return basePoints;
  return Math.round(basePoints * weight);
}

export interface BudgetSnapshot {
  budgetOffr: string;
  totalPaidOffr: string;
  remainingOffr: string;
  utilisationPct: number;
}

export function budgetSnapshot(budgetOffr: string, totalPaidOffr: string): BudgetSnapshot {
  const budget = toScaled(budgetOffr);
  const paid = toScaled(totalPaidOffr);
  const remaining = budget - paid > 0n ? budget - paid : 0n;
  const pct = budget === 0n ? 0 : Number((paid * 10000n) / budget) / 100;
  return {
    budgetOffr,
    totalPaidOffr,
    remainingOffr: fromScaled(remaining),
    utilisationPct: Math.min(100, Math.max(0, pct)),
  };
}
