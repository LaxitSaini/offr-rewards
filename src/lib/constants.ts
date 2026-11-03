/**
 * Campaign constants. These are public facts about the $OFFR token and the
 * campaign and are intentionally not secrets.
 */
export const OFFR = {
  name: "OFFR Rewards",
  tokenName: "OFFLINE RESEARCH",
  symbol: "OFFR",
  chainId: 8453,
  chainName: "Base Mainnet",
  tokenAddress: "0xee9069e8f520652e59674fad2120f6dea2671ba3",
  explorer: "https://basescan.org",
  xHandle: "OFFR35",
  xUrl: "https://x.com/OFFR35",
  telegramUrl: "https://t.me/OFFR77",
  docsUrl: "https://x.com/OFFR35",
} as const;

export const TOKEN_ADDRESS = OFFR.tokenAddress as `0x${string}`;
export const CHAIN_ID = OFFR.chainId;

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected", "paid"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const TASK_TYPES = [
  "telegram",
  "x_follow",
  "x_post",
  "meme",
  "content",
  "referral",
  "hold",
  "custom",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const AUTO_VERIFY_KINDS = ["none", "telegram", "x_post", "onchain_hold"] as const;
export type AutoVerifyKind = (typeof AUTO_VERIFY_KINDS)[number];

export const POINT_REASONS = {
  submission: "submission_approved",
  referral: "referral_credited",
  holding: "holding_bonus",
  manual: "manual_adjustment",
} as const;
