/**
 * @file resolve.ts
 * @description RESOLVE phase — AI oracle for on-chain market resolution.
 *
 * Each cycle this module:
 *   1. Fetches all active markets from MarketFactory
 *   2. For markets past their closingTime with no pending resolution:
 *        - Reads the current ETH/USD price from Chainlink
 *        - Parses the market question to extract a price threshold
 *        - Determines YES or NO outcome
 *        - Calls MarketResolver.aiResolve() with on-chain reasoning string
 *   3. For markets with a pending resolution past the 24h dispute window:
 *        - Calls MarketResolver.finalizeResolution() to settle on-chain
 *
 * The agent wallet (AGENT_SEED_PHRASE account 0) is the registered aiOracle
 * on the MarketResolver contract, so only it can propose AI resolutions.
 *
 * @license Apache-2.0
 */

import { ethers } from "ethers";
import { getEthersSigner, fetchActiveMarkets, CONDITIONAL_PAYMENT_ABI } from "./contracts.js";


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

const OutcomeIndex = { INVALID: 0, YES: 1, NO: 2 } as const;

/**
 * After a market is finalized, tries to claim any matching ConditionalPayment
 * escrows using the treasury (deployer) key. Silent on failure.
 */
async function autoClaimEscrows(
  rpcUrl: string,
  marketAddress: string,
  resolvedOutcome: number,
  agentAddress: string
): Promise<void> {
  const cpAddress      = process.env["CONDITIONAL_PAYMENT_ADDRESS"];
  const deployerKey    = process.env["DEPLOYER_PRIVATE_KEY"];
  if (!cpAddress || !deployerKey) return;

  try {
    const provider      = new ethers.JsonRpcProvider(rpcUrl);
    const treasury      = new ethers.Wallet(deployerKey.trim(), provider);
    const cp            = new ethers.Contract(cpAddress, CONDITIONAL_PAYMENT_ABI, treasury) as any;

    const paymentIds: string[] = await cp.getCreatorPayments(agentAddress);
    if (!paymentIds.length) return;

    for (const id of paymentIds) {
      try {
        const p = await cp.getPayment(id);
        const alreadySettled = p.claimedAmount >= p.totalAmount || p.cancelled;
        const matchesMarket  = p.market.toLowerCase() === marketAddress.toLowerCase();
        const matchesOutcome = Number(p.triggerOutcome) === resolvedOutcome;
        if (!alreadySettled && matchesMarket && matchesOutcome) {
          const tx = await cp.claimPayment(id);
          await tx.wait();
          console.log(`  ✓ ConditionalPayment claimed: ${id.slice(0, 10)}… TX: ${tx.hash}`);
        }
      } catch { /* individual claim failure is non-fatal */ }
    }
  } catch (err) {
    console.warn(`[RESOLVE] Auto-claim escrows failed: ${err instanceof Error ? err.message : err}`);
  }
}

const CHAINLINK_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];


/**
 * Parses a dollar threshold from a market question string.
 * e.g. "Will ETH price be above $2,500 within 14 days?" → 2500
 * Returns null if no threshold found.
 */
function parseThresholdFromQuestion(question: string): number | null {
  const match = question.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const raw = match[1]!.replace(/,/g, "");
  const value = parseFloat(raw);
  return isNaN(value) ? null : value;
}

/**
 * Fetches the latest ETH price from a Chainlink feed.
 * Returns price as a plain number (USD).
 */
async function fetchChainlinkPrice(
  feedAddress: string,
  provider: ethers.Provider
): Promise<number> {
  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider) as any;
  const [, answer] = await feed.latestRoundData();
  const decimals: number = await feed.decimals();
  return Number(answer) / 10 ** decimals;
}

/**
 * Derives the deterministic bytes32 marketId used by MarketResolver
 * from a market address. Must match what deploy-resolver.mjs used:
 *   ethers.zeroPadValue(marketAddress, 32)
 */
function marketIdFromAddress(address: string): string {
  return ethers.zeroPadValue(address, 32);
}


interface OnChainResolution {
  outcome: number;
  source: number;
  timestamp: bigint;
  resolvedBy: string;
  finalized: boolean;
}


export interface ResolveResult {
  marketAddress: string;
  marketId: string;
  action: "proposed" | "finalized" | "skipped";
  outcome?: "YES" | "NO";
  rationale?: string;
  txHash?: string;
  error?: string;
}

/**
 * Checks all active markets and performs AI oracle resolution where needed.
 *
 * @param rpcUrl  - JSON-RPC endpoint
 * @param dryRun  - If true, logs what would happen but submits no transactions
 */
export async function resolveMarkets(
  rpcUrl: string,
  dryRun: boolean
): Promise<ResolveResult[]> {
  const resolverAddress = process.env["MARKET_RESOLVER_ADDRESS"];
  if (!resolverAddress) {
    return [];
  }

  const signer = getEthersSigner(rpcUrl);
  const resolver = new ethers.Contract(resolverAddress, MARKET_RESOLVER_ABI, signer) as any;

  const registeredOracle: string = await resolver.aiOracle();
  const agentAddress = await signer.getAddress();
  if (registeredOracle.toLowerCase() !== agentAddress.toLowerCase()) {
    console.warn(
      `[RESOLVE] Agent wallet ${agentAddress} is not the registered aiOracle ` +
      `(${registeredOracle}). Skipping resolution.`
    );
    return [];
  }

  const markets = await fetchActiveMarkets(rpcUrl);
  const now = Math.floor(Date.now() / 1000);
  const results: ResolveResult[] = [];

  for (const market of markets) {
    const marketId = marketIdFromAddress(market.address);

    const registered: string = await resolver.registeredMarkets(marketId);
    if (registered === ethers.ZeroAddress) {
      continue;
    }

    const res: OnChainResolution = await resolver.resolutions(marketId);

    if (res.finalized) continue;

    if (res.timestamp > 0n) {
      const DISPUTE_WINDOW_AI = 24 * 3600;
      const DISPUTE_WINDOW    = 48 * 3600;
      const window = res.source === 3 /* AI_ORACLE */ ? DISPUTE_WINDOW_AI : DISPUTE_WINDOW;
      const canFinalize = now >= Number(res.timestamp) + window;

      if (canFinalize) {
        console.log(`[RESOLVE] Finalizing resolution for market ${market.address}…`);
        if (dryRun) {
          results.push({ marketAddress: market.address, marketId, action: "finalized", outcome: res.outcome === 1 ? "YES" : "NO" });
          console.log(`  [DRY RUN] Would call finalizeResolution()`);
          continue;
        }
        try {
          const tx = await resolver.finalizeResolution(marketId);
          await tx.wait();
          console.log(`  ✓ Market resolved on-chain. TX: ${tx.hash}`);
          await autoClaimEscrows(rpcUrl, market.address, res.outcome, agentAddress);
          results.push({ marketAddress: market.address, marketId, action: "finalized", outcome: res.outcome === 1 ? "YES" : "NO", txHash: tx.hash });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.warn(`  ✗ finalizeResolution failed: ${error}`);
          results.push({ marketAddress: market.address, marketId, action: "skipped", error });
        }
        continue;
      }

      const waitHours = ((Number(res.timestamp) + window - now) / 3600).toFixed(1);
      console.log(`[RESOLVE] Market ${market.address.slice(0,10)}… — resolution pending, finalize in ~${waitHours}h`);
      results.push({ marketAddress: market.address, marketId, action: "skipped" });
      continue;
    }

    if (now < market.closingTime) {
      continue;
    }

    console.log(`[RESOLVE] Market expired: "${market.question}"`);

    const threshold = parseThresholdFromQuestion(market.question);
    if (threshold === null) {
      console.warn(`  [RESOLVE] Cannot parse threshold from question — skipping`);
      results.push({ marketAddress: market.address, marketId, action: "skipped", error: "Cannot parse threshold" });
      continue;
    }

    const feedAddress: string = await resolver.chainlinkFeeds(marketId);
    const chainlinkEthUsdSepolia = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
    const activeFeed = feedAddress !== ethers.ZeroAddress ? feedAddress : chainlinkEthUsdSepolia;

    let currentPrice: number;
    try {
      currentPrice = await fetchChainlinkPrice(activeFeed, signer.provider!);
    } catch (err) {
      console.warn(`  [RESOLVE] Chainlink fetch failed: ${err instanceof Error ? err.message : err}`);
      results.push({ marketAddress: market.address, marketId, action: "skipped", error: "Chainlink fetch failed" });
      continue;
    }

    const isYes =
      market.question.toLowerCase().includes("above") ||
      market.question.toLowerCase().includes("over") ||
      market.question.toLowerCase().includes("exceed")
        ? currentPrice >= threshold
        : currentPrice < threshold;

    const outcome = isYes ? OutcomeIndex.YES : OutcomeIndex.NO;
    const outcomeLabel: "YES" | "NO" = isYes ? "YES" : "NO";
    const closedAt = new Date(market.closingTime * 1000).toISOString();

    const rationale =
      `Market: "${market.question}". ` +
      `Closed at: ${closedAt}. ` +
      `Chainlink ETH/USD at resolution: $${currentPrice.toFixed(2)}. ` +
      `Threshold: $${threshold}. ` +
      `${isYes ? "Price ABOVE threshold" : "Price BELOW threshold"} → ${outcomeLabel}. ` +
      `Resolved autonomously by AI oracle (agent ${agentAddress}).`;

    console.log(`  ETH price: $${currentPrice.toFixed(2)} | threshold: $${threshold} → ${outcomeLabel}`);
    console.log(`  Rationale: ${rationale}`);

    if (dryRun) {
      results.push({ marketAddress: market.address, marketId, action: "proposed", outcome: outcomeLabel, rationale });
      console.log(`  [DRY RUN] Would call aiResolve(${outcomeLabel})`);
      continue;
    }

    try {
      const tx = await resolver.aiResolve(marketId, outcome, rationale);
      await tx.wait();
      console.log(`  ✓ aiResolve() submitted. TX: ${tx.hash}`);
      console.log(`  Dispute window: 24h. Call finalizeResolution() after ${new Date((Date.now() + 24 * 3600 * 1000)).toISOString()}`);
      results.push({ marketAddress: market.address, marketId, action: "proposed", outcome: outcomeLabel, rationale, txHash: tx.hash });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ aiResolve failed: ${error}`);
      results.push({ marketAddress: market.address, marketId, action: "skipped", error });
    }
  }

  if (results.length === 0) {
    console.log("[RESOLVE] No markets need resolution this cycle.");
  }

  return results;
}
