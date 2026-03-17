/**
 * @file bridge.ts
 * @description USDT0 cross-chain bridge via Tether's WDK bridge protocol.
 *
 * USDT0 (LayerZero OFT) lets the agent move USD₮ across chains — e.g.
 * bridge USDT from Ethereum to Arbitrum to access higher-yield DeFi protocols.
 *
 * Wraps @tetherto/wdk-protocol-bridge-usdt0-evm with typed helpers that
 * match the style of transactions.ts.
 *
 * Note: USDT0 OFT contracts are deployed on mainnet chains only.
 *       On Sepolia testnet this will throw — gate with USDT0_BRIDGE_ENABLED.
 *
 * @license Apache-2.0
 */

import type { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Usdt0ProtocolEvm = require("@tetherto/wdk-protocol-bridge-usdt0-evm").default;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Chains supported by the USDT0 OFT bridge. */
export type BridgeTargetChain = "arbitrum" | "polygon" | "berachain";

export interface BridgeParams {
  /** Destination chain. */
  targetChain: BridgeTargetChain;
  /** Recipient address on the target chain (defaults to agent's own address). */
  recipient: string;
  /** USDT token address on the source chain. */
  tokenAddress: string;
  /** Amount in micro-USDT (6 decimals, e.g. 10_000_000n = 10 USDT). */
  amount: bigint;
}

export interface BridgeResult {
  /** Source-chain transaction hash. */
  hash: string;
  /** Gas fee paid on source chain, in wei. */
  fee: bigint;
  /** LayerZero bridge fee (paid in ETH), in wei. */
  bridgeFee: bigint;
  targetChain: BridgeTargetChain;
  amount: bigint;
  timestamp: number;
}

export interface BridgeQuote {
  /** Estimated gas fee in wei. */
  estimatedFee: bigint;
  /** LayerZero bridge fee in wei. */
  bridgeFee: bigint;
  /** Total cost in wei (gas + bridge fee). */
  totalFeeWei: bigint;
}

// ─── Max bridge fee cap (0.005 ETH) ──────────────────────────────────────────

const BRIDGE_MAX_FEE = 5_000_000_000_000_000n; // 0.005 ETH

// ─── Quote ────────────────────────────────────────────────────────────────────

/**
 * Estimates the cost of bridging USDT to another chain via USDT0.
 * Does NOT submit a transaction.
 */
export async function quoteBridgeUsdt0(
  account: WalletAccountEvm,
  params: BridgeParams
): Promise<BridgeQuote> {
  const protocol = new Usdt0ProtocolEvm(account, { bridgeMaxFee: BRIDGE_MAX_FEE });

  const quote = await protocol.quoteBridge({
    targetChain: params.targetChain,
    recipient: params.recipient,
    token: params.tokenAddress,
    amount: params.amount,
  });

  return {
    estimatedFee: quote.fee,
    bridgeFee: quote.bridgeFee,
    totalFeeWei: quote.fee + quote.bridgeFee,
  };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

/**
 * Bridges USD₮ to another chain using the USDT0 LayerZero OFT protocol.
 *
 * The WDK bridge protocol handles:
 *   - OFT token approval (if needed)
 *   - LayerZero message fee payment
 *   - Transaction signing via WalletAccountEvm
 *
 * @throws If USDT0 contracts are not deployed on the source chain (e.g. Sepolia).
 */
export async function bridgeUsdt0(
  account: WalletAccountEvm,
  params: BridgeParams
): Promise<BridgeResult> {
  const protocol = new Usdt0ProtocolEvm(account, { bridgeMaxFee: BRIDGE_MAX_FEE });

  const result = await protocol.bridge({
    targetChain: params.targetChain,
    recipient: params.recipient,
    token: params.tokenAddress,
    amount: params.amount,
  });

  return {
    hash: result.hash,
    fee: result.fee,
    bridgeFee: result.bridgeFee,
    targetChain: params.targetChain,
    amount: params.amount,
    timestamp: Date.now(),
  };
}
