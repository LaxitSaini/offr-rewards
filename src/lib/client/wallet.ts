"use client";

import { apiFetch } from "@/lib/client/api";

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isBraveWallet?: boolean;
  providers?: Eip1193Provider[];
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    coinbaseWalletExtension?: Eip1193Provider;
    okxwallet?: Eip1193Provider;
  }
}

export const BASE_CHAIN_ID_HEX = "0x2105"; // 8453

const BASE_CHAIN_PARAMS = {
  chainId: BASE_CHAIN_ID_HEX,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

export interface WalletOption {
  id: string;
  name: string;
  provider: Eip1193Provider;
}

export class WalletError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

/** Enumerates injected wallets (MetaMask, Coinbase, Rabby, Brave, OKX). */
export function detectWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  const found: WalletOption[] = [];
  const seen = new Set<unknown>();

  const push = (provider: Eip1193Provider | undefined, id: string, name: string) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    found.push({ id, name, provider });
  };

  const injected = window.ethereum;
  if (injected?.providers?.length) {
    for (const p of injected.providers) {
      if (p.isMetaMask && !p.isBraveWallet && !p.isRabby) push(p, "metamask", "MetaMask");
      else if (p.isRabby) push(p, "rabby", "Rabby");
      else if (p.isCoinbaseWallet) push(p, "coinbase", "Coinbase Wallet");
      else if (p.isBraveWallet) push(p, "brave", "Brave Wallet");
    }
  }
  if (injected) {
    if (injected.isRabby) push(injected, "rabby", "Rabby");
    else if (injected.isCoinbaseWallet) push(injected, "coinbase", "Coinbase Wallet");
    else if (injected.isMetaMask && !injected.isBraveWallet) push(injected, "metamask", "MetaMask");
    else if (injected.isBraveWallet) push(injected, "brave", "Brave Wallet");
    else push(injected, "injected", "Browser wallet");
  }
  push(window.coinbaseWalletExtension, "coinbase-ext", "Coinbase Wallet");
  const okx = window.okxwallet as Eip1193Provider | undefined;
  if (okx) push(okx, "okx", "OKX Wallet");

  return found;
}

export async function connectWallet(provider: Eip1193Provider): Promise<{ address: string; chainId: number }> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4001) throw new WalletError("rejected", "You rejected the connection request in your wallet.");
    throw new WalletError("connect_failed", (err as Error).message || "Wallet connection failed.");
  }
  const account = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
    throw new WalletError("no_account", "Your wallet did not return an account.");
  }

  const chainHex = String(await provider.request({ method: "eth_chainId" }));
  if (chainHex.toLowerCase() !== BASE_CHAIN_ID_HEX) {
    await ensureBaseNetwork(provider);
  }

  const finalChain = Number.parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
  if (finalChain !== 8453) {
    throw new WalletError(
      "wrong_network",
      "Please switch your wallet to Base (chain ID 8453) and try again.",
    );
  }
  return { address: account, chainId: finalChain };
}

async function ensureBaseNetwork(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [BASE_CHAIN_PARAMS],
        });
        return;
      } catch {
        throw new WalletError("wrong_network", "Add the Base network to your wallet to continue.");
      }
    }
    if (code === 4001) {
      throw new WalletError("wrong_network", "Switch your wallet to Base to continue.");
    }
    throw new WalletError("wrong_network", "We could not switch your wallet to Base. Add chain ID 8453 manually.");
  }
}

export function toHexUtf8(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function signInWithWallet(args: {
  provider: Eip1193Provider;
  address: string;
  referralCode?: string | null;
}): Promise<{ csrf: string; created: boolean }> {
  const nonce = await apiFetch<{ message: string; expiresAt: number }>("/api/auth/nonce", {
    method: "POST",
    body: { address: args.address },
  });

  let signature: unknown;
  try {
    signature = await args.provider.request({
      method: "personal_sign",
      params: [toHexUtf8(nonce.message), args.address],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4001) throw new WalletError("rejected", "Signature request was rejected.");
    throw new WalletError("signature_failed", (err as Error).message || "Signing failed.");
  }

  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new WalletError("signature_failed", "Your wallet returned an invalid signature.");
  }

  const result = await apiFetch<{ csrf: string; created: boolean }>("/api/auth/verify", {
    method: "POST",
    body: {
      address: args.address,
      signature,
      referralCode: args.referralCode ?? null,
    },
  });
  return { csrf: result.csrf, created: result.created };
}
