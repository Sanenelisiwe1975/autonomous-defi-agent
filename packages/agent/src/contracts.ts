/**
 * @file contracts.ts
 * @description Ethers signer + ABI helpers for on-chain contract interaction.
 *
 * Provides:
 *   - getEthersSigner()  — derives an ethers.Wallet from AGENT_SEED_PHRASE
 *   - MarketFactory / PredictionMarket ABIs (minimal, read + write)
 *   - Helper to call MarketFactory.getActiveMarkets() and fetch market details
 *
 * @license Apache-2.0
 */

import { ethers } from "ethers";

/**
 * Returns an ethers Wallet connected to the given RPC endpoint.
 * Derives account index 0 from AGENT_SEED_PHRASE (same account as WDK).
 */
export function getEthersSigner(rpcUrl: string): ethers.HDNodeWallet {
  const seedPhrase = process.env["AGENT_SEED_PHRASE"];
  if (!seedPhrase) throw new Error("Missing AGENT_SEED_PHRASE");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return ethers.Wallet.fromPhrase(seedPhrase, provider);
}

export const MARKET_FACTORY_ABI = [
  "function getActiveMarkets() external view returns (address[])",
  "function marketCount() external view returns (uint256)",
  "function isActive(address) external view returns (bool)",
];

export const PREDICTION_MARKET_ABI = [
  "function question() external view returns (string)",
  "function closingTime() external view returns (uint256)",
  "function yesReserve() external view returns (uint256)",
  "function noReserve() external view returns (uint256)",
  "function totalDeposited() external view returns (uint256)",
  "function feeBps() external view returns (uint256)",
  "function resolvedOutcome() external view returns (uint8)",
  "function impliedYesProbability() external view returns (uint256)",
  "function yesToken() external view returns (address)",
  "function noToken() external view returns (address)",
  "function enterPosition(bool isYes, uint256 usdtIn, uint256 minTokensOut) external returns (uint256 tokensOut)",
  "function redeem(uint256 amount) external returns (uint256 usdtOut)",
  "function quoteEnterPosition(bool isYes, uint256 usdtIn) external view returns (uint256 tokensOut)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

// OutcomeIndex enum values (matching IMarket.sol): INVALID=0, YES=1, NO=2
export const OutcomeIndex = { INVALID: 0, YES: 1, NO: 2 } as const;

// PayoffType enum values (matching ConditionalPayment.sol): LINEAR=0, BINARY=1, CUSTOM=2
export const PayoffType = { LINEAR: 0, BINARY: 1, CUSTOM: 2 } as const;

export const CONDITIONAL_PAYMENT_ABI = [
  // Write
  "function createPayment(address beneficiary, address market, bytes32 marketId, address collateral, uint256 amount, uint8 trigger, uint8 payoffType, bytes calldata customPayoff, uint256 expiresAt) external returns (bytes32 paymentId)",
  "function claimPayment(bytes32 paymentId) external returns (uint256 payout)",
  "function refundPayment(bytes32 paymentId) external",
  "function cancelPayment(bytes32 paymentId) external",
  // Read
  "function getPayment(bytes32 id) external view returns (tuple(bytes32 id, address creator, address beneficiary, address market, bytes32 marketId, address collateralToken, uint256 totalAmount, uint256 claimedAmount, uint8 triggerOutcome, uint8 payoffType, bytes customPayoff, uint256 expiresAt, bool cancelled))",
  "function getCreatorPayments(address user) external view returns (bytes32[])",
];

export const MARKET_RESOLVER_ABI = [
  "function aiResolve(bytes32 marketId, uint8 outcome, string calldata rationale) external",
  "function chainlinkResolve(bytes32 marketId) external",
  "function finalizeResolution(bytes32 marketId) external",
  "function registeredMarkets(bytes32 marketId) external view returns (address)",
  "function resolutions(bytes32 marketId) external view returns (uint8 outcome, uint8 source, uint256 timestamp, address resolvedBy, bool finalized)",
  "function resolutionPrices(bytes32 marketId) external view returns (int256)",
  "function chainlinkFeeds(bytes32 marketId) external view returns (address)",
  "function aiOracle() external view returns (address)",
];

export interface OnChainMarket {
  address: string;
  question: string;
  closingTime: number;
  yesReserve: bigint;
  noReserve: bigint;
  totalDeposited: bigint;
  feeBps: bigint;
  /** Implied YES probability (0–1). */
  yesProbability: number;
  /** Implied payout for a YES bet at current reserves. */
  yesPayoutMultiplier: number;
  /** Implied payout for a NO bet at current reserves. */
  noPayoutMultiplier: number;
  yesTokenAddress: string;
  noTokenAddress: string;
  /** false = market is resolved or closed */
  tradeable: boolean;
}

/**
 * Fetches all active markets from the deployed MarketFactory contract.
 * Returns an empty array if no factory address is configured or no markets exist.
 */
export async function fetchActiveMarkets(
  rpcUrl: string
): Promise<OnChainMarket[]> {
  const factoryAddress = process.env["MARKET_FACTORY_ADDRESS"];
  if (!factoryAddress) return [];

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory = new ethers.Contract(factoryAddress, MARKET_FACTORY_ABI, provider) as any;
    const addresses: string[] = await factory.getActiveMarkets();
    console.log(`[contracts] MarketFactory has ${addresses.length} active market(s)`);
    if (!addresses.length) return [];

    const now = Math.floor(Date.now() / 1000);

    return Promise.all(
      addresses.map(async (addr): Promise<OnChainMarket> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const market = new ethers.Contract(addr, PREDICTION_MARKET_ABI, provider) as any;

        const [
          question,
          closingTime,
          yesReserve,
          noReserve,
          totalDeposited,
          feeBps,
          impliedYesProb,
          yesTokenAddress,
          noTokenAddress,
          resolvedOutcome,
        ] = await Promise.all([
          market.question() as Promise<string>,
          market.closingTime() as Promise<bigint>,
          market.yesReserve() as Promise<bigint>,
          market.noReserve() as Promise<bigint>,
          market.totalDeposited() as Promise<bigint>,
          market.feeBps() as Promise<bigint>,
          market.impliedYesProbability() as Promise<bigint>,
          market.yesToken() as Promise<string>,
          market.noToken() as Promise<string>,
          market.resolvedOutcome() as Promise<number>,
        ]);

        const yesProbability = Number(impliedYesProb) / 1e18;
        const noProbability = 1 - yesProbability;
        const feeMultiplier = 1 - Number(feeBps) / 10_000;

        // Payout = 1/probability adjusted for fee
        const yesPayoutMultiplier = yesProbability > 0
          ? feeMultiplier / yesProbability
          : 0;
        const noPayoutMultiplier = noProbability > 0
          ? feeMultiplier / noProbability
          : 0;

        const tradeable =
          Number(resolvedOutcome) === 0 && Number(closingTime) > now;

        return {
          address: addr,
          question,
          closingTime: Number(closingTime),
          yesReserve,
          noReserve,
          totalDeposited,
          feeBps,
          yesProbability,
          yesPayoutMultiplier,
          noPayoutMultiplier,
          yesTokenAddress,
          noTokenAddress,
          tradeable,
        };
      })
    );
  } catch (err) {
    console.warn("[contracts] fetchActiveMarkets failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
