/**
 * @file reason.ts
 * @description REASON phase — OpenClaw LLM planning.
 *
 * Converts the Observe phase output into a structured ActionPlan
 * using the OpenClaw planner (LangChain.js + GPT-4o).
 *
 * @license Apache-2.0
 */

import { getPlanner, type ActionPlan } from "@repo/planner";
import type { ObserveResult } from "./observe.js";
import { fetchActiveMarkets, ERC20_ABI } from "./contracts.js";
import { ethers } from "ethers";


/**
 * Sums the agent's YES and NO token balances across all active prediction markets.
 * Returns the total value in micro-USDT (approximated at face value: 1 token = 1 micro-USDT).
 */
async function fetchPredictionPositions(rpcUrl: string, agentAddress: string): Promise<bigint> {
  try {
    const markets = await fetchActiveMarkets(rpcUrl);
    if (!markets.length) return 0n;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    let total = 0n;

    for (const market of markets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const yesToken = new ethers.Contract(market.yesTokenAddress, ERC20_ABI, provider) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noToken = new ethers.Contract(market.noTokenAddress, ERC20_ABI, provider) as any;
      const [yesBal, noBal]: [bigint, bigint] = await Promise.all([
        yesToken.balanceOf(agentAddress),
        noToken.balanceOf(agentAddress),
      ]);
      total += yesBal + noBal;
    }
    return total;
  } catch {
    return 0n;
  }
}

/**
 * Runs the Reason phase — converts market signals into a structured plan.
 *
 * @param signals - Output from the Observe phase
 * @param rpcUrl  - JSON-RPC endpoint (for on-chain position queries)
 */
export async function reason(signals: ObserveResult, rpcUrl: string): Promise<ActionPlan> {
  console.log("[REASON] Invoking OpenClaw planner…");

  const planner = getPlanner();

  const predictionPositionsMicro = await fetchPredictionPositions(
    rpcUrl,
    signals.portfolio.address
  );

  const plan = await planner.plan({
    prices: signals.prices,
    gas: signals.gas,
    opportunities: signals.opportunities,
    liquidity: signals.liquidity,
    portfolio: {
      ethWei: signals.portfolio.ethWei,
      usdtMicro: signals.portfolio.usdtMicro,
      xautMicro: signals.portfolio.xautMicro,
      predictionPositionsMicro,
      yieldPositionsMicro: 0n,
      lpPositionsMicro: 0n,
    },
  });

  console.log(
    `[REASON] Plan: ${plan.actions.length} action(s) | ` +
    `Sentiment: ${plan.marketSentiment} | ` +
    `Hold: ${plan.recommendHold}`
  );

  if (plan.reasoning) {
    console.log(`[REASON] Reasoning: ${plan.reasoning.slice(0, 200)}…`);
  }

  return plan;
}
