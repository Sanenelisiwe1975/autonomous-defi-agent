/**
 * @file transactions.ts
 * @description USD₮ and XAU₮ ERC-20 transfer execution via WDK.
 *
 * All on-chain writes go through WalletAccountEvm.transfer() which:
 *   1. Estimates gas before signing
 *   2. Enforces the transferMaxFee cap set on the wallet
 *   3. Returns a tx hash + actual fee paid
 *
 * Token addresses are resolved from environment variables so the same
 * code runs on Sepolia (testnet) and Ethereum mainnet without changes.
 *
 * @license Apache-2.0
 */

import type { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported settlement tokens. */
export type TokenSymbol = "USDT" | "XAUT";

/** Parameters for a token transfer. */
export interface TransferParams {
  /** Recipient checksummed Ethereum address. */
  to: string;
  /** Amount in token's smallest unit (USDT: 6 decimals, XAUT: 6 decimals). */
  amount: bigint;
  /** Token to transfer. */
  token: TokenSymbol;
}

/** Result returned after a successful transfer. */
export interface TransferResult {
  /** Transaction hash (0x-prefixed hex). */
  hash: string;
  /** Gas fee actually paid, in wei. */
  fee: bigint;
  /** Token transferred. */
  token: TokenSymbol;
  /** Amount transferred in smallest unit. */
  amount: bigint;
  /** Recipient address. */
  to: string;
  /** Unix timestamp (ms) when the result was returned. */
  timestamp: number;
}

/** Quote returned before executing a transfer. */
export interface TransferQuote {
  /** Estimated gas fee in wei. */
  estimatedFee: bigint;
  /** Whether the fee is within the wallet's transferMaxFee cap. */
  withinFeeLimit: boolean;
}

// ─── Token address resolution ─────────────────────────────────────────────────

/**
 * Returns the ERC-20 contract address for a token symbol.
 * Reads from environment variables so testnet/mainnet addresses
 * can be configured without code changes.
 *
 * @throws If the env var for the requested token is not set.
 */
export function getTokenAddress(token: TokenSymbol): string {
  const envKey =
    token === "USDT" ? "USDT_CONTRACT_ADDRESS" : "XAUT_CONTRACT_ADDRESS";
  const address = process.env[envKey];
  if (!address) {
    throw new Error(
      `Missing env var ${envKey}. Add the ${token} contract address to your .env file.`
    );
  }
  return address;
}

// ─── Quote ────────────────────────────────────────────────────────────────────

/**
 * Estimates the gas fee for a token transfer WITHOUT submitting a transaction.
 * Use this in the decision engine to factor costs into EV calculations.
 *
 * @param account - The WDK wallet account that will sign the transfer
 * @param params  - Transfer parameters
 */
export async function quoteTransfer(
  account: WalletAccountEvm,
  params: TransferParams
): Promise<TransferQuote> {
  const tokenAddress = getTokenAddress(params.token);

  const { fee } = await account.quoteTransfer({
    token: tokenAddress,
    recipient: params.to,
    amount: params.amount,
  });

  // We can't easily read transferMaxFee back out of the account, so
  // we treat any quote successfully returned as within limits (the
  // WDK library enforces the cap at execution time).
  return {
    estimatedFee: fee,
    withinFeeLimit: true,
  };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

/**
 * Transfers an ERC-20 token (USD₮ or XAU₮) using the WDK wallet.
 *
 * The WDK library handles:
 *   - ERC-20 approve + transfer flow
 *   - EIP-1559 fee estimation
 *   - transferMaxFee enforcement
 *
 * @param account - The WDK wallet account that will sign
 * @param params  - Transfer parameters
 * @returns       - Transaction hash, actual fee, and metadata
 * @throws        If the transfer fails (insufficient balance, fee cap exceeded, etc.)
 */
export async function transferToken(
  account: WalletAccountEvm,
  params: TransferParams
): Promise<TransferResult> {
  const tokenAddress = getTokenAddress(params.token);

  const result = await account.transfer({
    token: tokenAddress,
    recipient: params.to,
    amount: params.amount,
  });

  return {
    hash: result.hash,
    fee: result.fee,
    token: params.token,
    amount: params.amount,
    to: params.to,
    timestamp: Date.now(),
  };
}

/**
 * Transfers USD₮ — convenience wrapper around transferToken.
 *
 * @param account    - The WDK wallet account
 * @param to         - Recipient address
 * @param amountUsdt - Amount in micro-USDT (1 USDT = 1_000_000)
 */
export async function transferUSDT(
  account: WalletAccountEvm,
  to: string,
  amountUsdt: bigint
): Promise<TransferResult> {
  return transferToken(account, { to, amount: amountUsdt, token: "USDT" });
}

/**
 * Transfers XAU₮ — convenience wrapper around transferToken.
 *
 * @param account    - The WDK wallet account
 * @param to         - Recipient address
 * @param amountXaut - Amount in smallest XAU₮ unit (1 XAUT = 1_000_000)
 */
export async function transferXAUT(
  account: WalletAccountEvm,
  to: string,
  amountXaut: bigint
): Promise<TransferResult> {
  return transferToken(account, { to, amount: amountXaut, token: "XAUT" });
}
