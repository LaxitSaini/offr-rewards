import { createPublicClient, erc20Abi, formatUnits, http, verifyMessage as verifyEoaMessage } from "viem";
import { base } from "viem/chains";
import { CHAIN_ID, TOKEN_ADDRESS } from "@/lib/constants";
import { env } from "@/lib/env";
import { sha256 } from "@/lib/utils";

export interface TokenMeta {
  address: `0x${string}`;
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
  source: "onchain" | "fallback";
}

export interface BalanceResult {
  raw: bigint;
  formatted: string;
  blockNumber: bigint | null;
  meta: TokenMeta;
}

export interface TxLog {
  address: string;
  topics: string[];
  data: string;
}

export interface TxReceipt {
  status: "success" | "reverted";
  blockNumber: bigint | null;
  logs: TxLog[];
}

export interface ChainProvider {
  readonly mode: "live" | "mock";
  getTokenMeta(): Promise<TokenMeta>;
  getBalance(address: `0x${string}`): Promise<BalanceResult>;
  getTransactionReceipt(hash: `0x${string}`): Promise<TxReceipt | null>;
  hasCode(address: `0x${string}`): Promise<boolean>;
  verifySignature(args: {
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  }): Promise<boolean>;
}

const FALLBACK_META: TokenMeta = {
  address: TOKEN_ADDRESS,
  chainId: CHAIN_ID,
  symbol: "OFFR",
  name: "OFFLINE RESEARCH",
  decimals: env.tokenDecimalsOverride ?? 18,
  source: "fallback",
};

const META_TTL_MS = 10 * 60 * 1000;
let cachedMeta: { value: TokenMeta; at: number } | null = null;

function cacheMeta(value: TokenMeta): TokenMeta {
  cachedMeta = { value, at: Date.now() };
  return value;
}

function liveProvider(): ChainProvider {
  const client = createPublicClient({
    chain: base,
    transport: http(env.baseRpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  return {
    mode: "live",

    async getTokenMeta() {
      if (cachedMeta && Date.now() - cachedMeta.at < META_TTL_MS) return cachedMeta.value;
      try {
        const [symbol, name, decimals] = await Promise.all([
          client.readContract({
            address: TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: "symbol",
          }),
          client.readContract({
            address: TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: "name",
          }),
          client.readContract({
            address: TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        ]);
        return cacheMeta({
          address: TOKEN_ADDRESS,
          chainId: CHAIN_ID,
          symbol: String(symbol),
          name: String(name),
          decimals: Number(decimals),
          source: "onchain",
        });
      } catch (err) {
        console.error("[chain] token metadata read failed:", (err as Error).message);
        return cacheMeta(FALLBACK_META);
      }
    },

    async getBalance(address) {
      const [raw, blockNumber, meta] = await Promise.all([
        client.readContract({
          address: TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        client.getBlockNumber().catch(() => null),
        this.getTokenMeta(),
      ]);
      return { raw: raw as bigint, formatted: formatUnits(raw as bigint, meta.decimals), blockNumber, meta };
    },

    async getTransactionReceipt(hash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        return {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          logs: receipt.logs.map((l) => ({
            address: l.address,
            topics: l.topics as string[],
            data: l.data,
          })),
        };
      } catch {
        return null;
      }
    },

    async hasCode(address) {
      try {
        const code = await client.getCode({ address });
        return Boolean(code && code !== "0x");
      } catch {
        return false;
      }
    },

    async verifySignature({ address, message, signature }) {
      try {
        // Handles EOAs and ERC-1271 smart contract wallets (Base Smart Wallet,
        // Coinbase Wallet smart accounts).
        return await client.verifyMessage({ address, message, signature });
      } catch {
        try {
          return await verifyEoaMessage({ address, message, signature });
        } catch {
          return false;
        }
      }
    },
  };
}

/**
 * Deterministic stand-in used only when CHAIN_MODE=mock (local development and
 * automated tests). It can never be enabled in production — see lib/env.ts.
 */
function mockProvider(): ChainProvider {
  const mockMeta: TokenMeta = {
    address: TOKEN_ADDRESS,
    chainId: CHAIN_ID,
    symbol: "OFFR",
    name: "OFFLINE RESEARCH (mock)",
    decimals: 18,
    source: "fallback",
  };
  return {
    mode: "mock",
    async getTokenMeta() {
      return mockMeta;
    },
    async getBalance(address) {
      const digest = sha256(address.toLowerCase());
      const whole = BigInt(`0x${digest.slice(0, 8)}`) % 5_000_001n;
      const raw = whole * 10n ** 18n;
      return { raw, formatted: formatUnits(raw, 18), blockNumber: 0n, meta: mockMeta };
    },
    async getTransactionReceipt() {
      return null;
    },
    async hasCode() {
      return true;
    },
    async verifySignature({ address, message, signature }) {
      try {
        return await verifyEoaMessage({ address, message, signature });
      } catch {
        return false;
      }
    },
  };
}

let override: ChainProvider | null = null;

export function getChain(): ChainProvider {
  if (override) return override;
  return env.chainMode === "mock" ? mockProvider() : liveProvider();
}

/** Test seam — never called from application code. */
export function __setChainProviderForTests(provider: ChainProvider | null): void {
  override = provider;
}

export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
