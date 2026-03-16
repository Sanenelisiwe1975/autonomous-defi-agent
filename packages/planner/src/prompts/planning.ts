/**
 * @file prompts/planning.ts
 * @description LangChain.js prompt templates for the OpenClaw planning chain.
 *
 * These templates are used to format market data and inject it into the
 * LLM context window in a consistent, structured way.
 *
 * @license Apache-2.0
 */

import type { OraclePrices } from "@repo/data";
import type { GasSnapshot } from "@repo/data";
import type { LiquiditySnapshot } from "@repo/data";
import type { GoalSet } from "../goals.js";

// ─── Market opportunity formatting ────────────────────────────────────────────

export interface RawOpportunity {
  marketId: string;
  description: string;
  probability: number;
  payoutMultiplier: number;
  tvlUsd: number;
  expiresInBlocks: number;
}

/**
 * Formats oracle price data for insertion into the planning prompt.
 */
export function formatPricesForPrompt(prices: OraclePrices): string {
  return [
    `ETH/USD: $${prices.eth.priceUsd.toFixed(2)} (${prices.eth.source})`,
    `USDT/USD: $${prices.usdt.priceUsd.toFixed(4)} (${prices.usdt.source})`,
    `XAU/USD: $${prices.xau.priceUsd.toFixed(2)} (${prices.xau.source})`,
  ].join("\n");
}

/**
 * Formats gas snapshot for insertion into the planning prompt.
 */
export function formatGasForPrompt(gas: GasSnapshot): string {
  const congested = gas.baseFeeGwei > 50 ? " ⚠️ CONGESTED" : "";
  return [
    `Base fee: ${gas.baseFeeGwei.toFixed(1)} gwei${congested}`,
    `Max fee (normal): ${gas.maxFeeGwei.toFixed(1)} gwei`,
    `ERC-20 transfer cost: ~$${gas.erc20TransferCostUsd.toFixed(3)}`,
  ].join("\n");
}

/**
 * Formats liquidity snapshots for insertion into the planning prompt.
 */
export function formatLiquidityForPrompt(snapshots: LiquiditySnapshot[]): string {
  if (snapshots.length === 0) return "No liquidity data available.";
  return snapshots
    .map(
      (s) =>
        `${s.id}: TVL $${(s.tvlUsd / 1000).toFixed(0)}k | ` +
        `Available $${(s.availableLiquidityUsd / 1000).toFixed(0)}k | ` +
        `Impact@$100: ${s.priceImpact100Usd.toFixed(3)}% | ` +
        `APR: ${s.aprPct.toFixed(1)}%`
    )
    .join("\n");
}

/**
 * Formats available market opportunities for insertion into the planning prompt.
 */
export function formatOpportunitiesForPrompt(
  opportunities: RawOpportunity[]
): string {
  if (opportunities.length === 0) {
    return "No prediction market opportunities detected this cycle.";
  }
  return opportunities
    .map((opp, i) => {
      const rawEv = opp.probability * opp.payoutMultiplier - 1;
      return [
        `[${i + 1}] Market: ${opp.marketId}`,
        `    Description: ${opp.description}`,
        `    Probability: ${(opp.probability * 100).toFixed(1)}%`,
        `    Payout: ${opp.payoutMultiplier}x`,
        `    Raw EV: ${(rawEv * 100).toFixed(2)}%`,
        `    TVL: $${(opp.tvlUsd / 1000).toFixed(0)}k`,
        `    Expires in: ${opp.expiresInBlocks > 0 ? `${opp.expiresInBlocks} blocks` : "no expiry"}`,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Formats portfolio goal state for insertion into the planning prompt.
 */
export function formatPortfolioForPrompt(
  goalSet: GoalSet,
  ethWei: bigint,
  ethPriceUsd: number
): string {
  const ethBalance = (Number(ethWei) / 1e18).toFixed(4);
  const ethUsd = ((Number(ethWei) / 1e18) * ethPriceUsd).toFixed(2);
  return (
    `ETH (gas): ${ethBalance} ETH ($${ethUsd})\n` +
    `Total portfolio: $${goalSet.totalPortfolioUsdt.toFixed(2)} USD₮\n\n` +
    `Allocation status:\n` +
    goalSet.goals
      .map(
        (g) =>
          `  ${g.satisfied ? "✓" : "✗"} ${g.name}: ` +
          `${(g.currentAllocation * 100).toFixed(1)}% ` +
          `(target ${(g.targetAllocation * 100).toFixed(0)}%)`
      )
      .join("\n")
  );
}

/**
 * Builds the complete user message for the planning chain by substituting
 * all template variables.
 */
export function buildPlanningMessage(params: {
  prices: OraclePrices;
  gas: GasSnapshot;
  goalSet: GoalSet;
  opportunities: RawOpportunity[];
  liquidity: LiquiditySnapshot[];
  ethWei: bigint;
}): string {
  const { prices, gas, goalSet, opportunities, liquidity, ethWei } = params;

  return `## Current Market Context

**Prices:**
${formatPricesForPrompt(prices)}

**Gas Conditions:**
${formatGasForPrompt(gas)}

**Portfolio State:**
${formatPortfolioForPrompt(goalSet, ethWei, prices.eth.priceUsd)}

**Available Opportunities:**
${formatOpportunitiesForPrompt(opportunities)}

**Liquidity Snapshot:**
${formatLiquidityForPrompt(liquidity)}

---

Analyze the above market data and generate a structured action plan.
Be conservative and data-driven. Only recommend actions with positive EV after gas costs.
Respond with a valid JSON object matching the ActionPlan schema.`;
}
