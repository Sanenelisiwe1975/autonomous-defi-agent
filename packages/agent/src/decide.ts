/**
 * @file decide.ts
 * @description DECIDE phase — EV based decision engine with risk filters.
 *
 * Takes the LLM's ActionPlan and applies hard quantitative constraints:
 *
 *   1. Skip all if risk gates are triggered (depeg, extreme gas)
 *   2. Skip if recommendHold === true
 *   3. For each action, calculate net EV after gas costs
 *   4. Reject if EV < AGENT_MIN_EV
 *   5. Reject if riskScore > AGENT_MAX_RISK_SCORE
 *   6. Clamp position size to 5% of portfolio
 *
 * @license Apache-2.0
 */

import {
  calculateRawEV,
  type ActionPlan,
  type AgentAction,
  type EnterMarketAction,
} from "@repo/planner";
import {
  estimateOperationCostUsd,
  isNetworkCongested,
} from "@repo/data";
import type { ObserveResult } from "./observe.js";

export interface DecisionResult {
  approved: AgentAction[];
  rejected: Array<{
    action: AgentAction;
    reason: string;
  }>;
  /** Net EV values for approved ENTER_MARKET actions (keyed by action ID). */
  netEvByActionId: Record<string, number>;
  skippedAll: boolean;
  skippedAllReason?: string;
}

function riskScore(action: EnterMarketAction): number {

  const uncertaintyRisk = (1 - action.probability) * 100;
  const payoutRisk = Math.min((action.payoutMultiplier - 1) * 20, 40);
  return Math.round(Math.min(uncertaintyRisk + payoutRisk, 100));
}

function maxPositionMicroUsdt(portfolioUsdtMicro: bigint): bigint {
  return (portfolioUsdtMicro * 5n) / 100n;
}

/**
 * Runs the Decide phase against a plan and market context.
 *
 * @param plan    - ActionPlan from the Reason phase
 * @param signals - ObserveResult for context (gas, portfolio, risk gates)
 */
export function decide(
  plan: ActionPlan,
  signals: ObserveResult
): DecisionResult {
  const minEv = parseFloat(process.env["AGENT_MIN_EV"] ?? "0.02");
  const maxRisk = parseInt(process.env["AGENT_MAX_RISK_SCORE"] ?? "70", 10);


  if (signals.riskGatesTriggered.length > 0) {
    console.log(
      "[DECIDE] Skipping all — risk gates triggered:",
      signals.riskGatesTriggered
    );
    return {
      approved: [],
      rejected: plan.actions.map((action) => ({
        action,
        reason: `Risk gate: ${signals.riskGatesTriggered.join(", ")}`,
      })),
      netEvByActionId: {},
      skippedAll: true,
      skippedAllReason: `Risk gates: ${signals.riskGatesTriggered.join("; ")}`,
    };
  }

  if (plan.recommendHold) {
    console.log("[DECIDE] LLM recommends HOLD — skipping all non-HOLD actions");
    return {
      approved: plan.actions.filter((a) => a.type === "HOLD"),
      rejected: plan.actions
        .filter((a) => a.type !== "HOLD")
        .map((action) => ({ action, reason: "LLM recommendHold = true" })),
      netEvByActionId: {},
      skippedAll: false,
    };
  }

  const congested = isNetworkCongested(signals.gas);

  const approved: AgentAction[] = [];
  const rejected: DecisionResult["rejected"] = [];
  const netEvByActionId: Record<string, number> = {};

  for (const action of plan.actions) {
    // HOLD always passes
    if (action.type === "HOLD") {
      approved.push(action);
      continue;
    }

    if (action.type === "REBALANCE") {
      approved.push(action);
      continue;
    }

    if (action.type === "EXIT_MARKET") {
      approved.push(action);
      continue;
    }

    if (action.type === "ENTER_MARKET") {
      const enterAction = action as EnterMarketAction;

      const rawEv = calculateRawEV(enterAction);
      const gasCostUsd = estimateOperationCostUsd(
        signals.gas,
        "marketEnter",
        signals.prices.eth.priceUsd
      );
      const positionUsd = Number(enterAction.amountMicroUsdt) / 1e6;
      const gasCostFraction = positionUsd > 0 ? gasCostUsd / positionUsd : 1;
      const netEv = rawEv - gasCostFraction;

      const effectiveMinEv = congested ? minEv * 2 : minEv;

      if (netEv < effectiveMinEv) {
        rejected.push({
          action,
          reason: `Net EV ${(netEv * 100).toFixed(2)}% below minimum ${(effectiveMinEv * 100).toFixed(1)}%`,
        });
        continue;
      }

      const risk = riskScore(enterAction);
      if (risk > maxRisk) {
        rejected.push({
          action,
          reason: `Risk score ${risk} exceeds max ${maxRisk}`,
        });
        continue;
      }

      const cap = maxPositionMicroUsdt(signals.portfolio.usdtMicro);
      if (enterAction.amountMicroUsdt > cap) {
        enterAction.amountMicroUsdt = cap;
        console.log(
          `[DECIDE] Clamped position for ${enterAction.marketId} to $${Number(cap) / 1e6}`
        );
      }

      if (enterAction.amountMicroUsdt < 1_000_000n) {
        rejected.push({
          action,
          reason: "Position size below $1 minimum after cap",
        });
        continue;
      }

      netEvByActionId[action.id] = netEv;
      approved.push(action);
    }
  }

  console.log(
    `[DECIDE] Approved ${approved.length}/${plan.actions.length} | ` +
    `Rejected ${rejected.length}`
  );

  for (const { action, reason } of rejected) {
    console.log(`  ✗ ${action.type}${action.type === "ENTER_MARKET" ? ` (${(action as EnterMarketAction).marketId})` : ""}: ${reason}`);
  }

  return { approved, rejected, netEvByActionId, skippedAll: false };
}
