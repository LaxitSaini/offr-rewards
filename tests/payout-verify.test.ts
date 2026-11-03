import { afterAll, describe, expect, it } from "vitest";
import { __setChainProviderForTests, ERC20_TRANSFER_TOPIC, type ChainProvider } from "@/lib/chain";
import { TOKEN_ADDRESS } from "@/lib/constants";
import { verifyPayoutTx } from "@/lib/services/payouts";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

const pad = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

function stubProvider(receipt: Awaited<ReturnType<ChainProvider["getTransactionReceipt"]>>): ChainProvider {
  return {
    mode: "mock",
    async getTokenMeta() {
      return {
        address: TOKEN_ADDRESS,
        chainId: 8453,
        symbol: "OFFR",
        name: "OFFLINE RESEARCH",
        decimals: 18,
        source: "fallback",
      };
    },
    async getBalance() {
      return {
        raw: 0n,
        formatted: "0",
        blockNumber: 1n,
        meta: {
          address: TOKEN_ADDRESS,
          chainId: 8453,
          symbol: "OFFR",
          name: "OFFLINE RESEARCH",
          decimals: 18,
          source: "fallback",
        },
      };
    },
    async getTransactionReceipt() {
      return receipt;
    },
    async hasCode() {
      return true;
    },
    async verifySignature() {
      return true;
    },
  };
}

const transferLog = (to: string, value: bigint) => ({
  address: TOKEN_ADDRESS,
  topics: [ERC20_TRANSFER_TOPIC, pad(OTHER), pad(to)],
  data: `0x${value.toString(16).padStart(64, "0")}`,
});

const amount = 25_000n * 10n ** 18n;

describe("on-chain payout verification", () => {
  afterAll(() => __setChainProviderForTests(null));

  it("rejects malformed transaction hashes", async () => {
    const result = await verifyPayoutTx({ txHash: "0x123", wallet: WALLET, amountRaw: amount, amount: "25000" });
    expect(result.status).toBe("failed");
  });

  it("fails when the transaction is unknown to the RPC", async () => {
    __setChainProviderForTests(stubProvider(null));
    const result = await verifyPayoutTx({
      txHash: `0x${"a".repeat(64)}`,
      wallet: WALLET,
      amountRaw: amount,
      amount: "25000",
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/not found/i);
  });

  it("fails when the transaction reverted", async () => {
    __setChainProviderForTests(
      stubProvider({ status: "reverted", blockNumber: 1n, logs: [transferLog(WALLET, amount)] }),
    );
    const result = await verifyPayoutTx({
      txHash: `0x${"b".repeat(64)}`,
      wallet: WALLET,
      amountRaw: amount,
      amount: "25000",
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/reverted/i);
  });

  it("fails when no OFFR was sent to the wallet", async () => {
    __setChainProviderForTests(
      stubProvider({ status: "success", blockNumber: 5n, logs: [transferLog(OTHER, amount)] }),
    );
    const result = await verifyPayoutTx({
      txHash: `0x${"c".repeat(64)}`,
      wallet: WALLET,
      amountRaw: amount,
      amount: "25000",
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/no OFFR transfer/i);
  });

  it("fails when the transfer is smaller than the recorded amount", async () => {
    __setChainProviderForTests(
      stubProvider({ status: "success", blockNumber: 5n, logs: [transferLog(WALLET, amount - 1n)] }),
    );
    const result = await verifyPayoutTx({
      txHash: `0x${"d".repeat(64)}`,
      wallet: WALLET,
      amountRaw: amount,
      amount: "25000",
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/less than/i);
  });

  it("verifies a matching OFFR transfer", async () => {
    __setChainProviderForTests(
      stubProvider({ status: "success", blockNumber: 42n, logs: [transferLog(WALLET, amount)] }),
    );
    const result = await verifyPayoutTx({
      txHash: `0x${"e".repeat(64)}`,
      wallet: WALLET,
      amountRaw: amount,
      amount: "25000",
    });
    expect(result.status).toBe("verified");
    expect(result.detail).toMatch(/Verified on Base at block 42/);
    expect(result.blockNumber).toBe(42);
  });

  it("sums multiple transfer logs to the same wallet", async () => {
    __setChainProviderForTests(
      stubProvider({
        status: "success",
        blockNumber: 43n,
        logs: [transferLog(WALLET, amount / 2n), transferLog(WALLET, amount / 2n)],
      }),
    );
    const result = await verifyPayoutTx({
      txHash: `0x${"f".repeat(64)}`,
      wallet: WALLET,
      amountRaw: amount,
      amount: "25000",
    });
    expect(result.status).toBe("verified");
  });
});
