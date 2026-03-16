/**
 * @file goals.ts
 * @description Agent goal definitions and portfolio allocation targets.
 *
 * The OpenClaw planner uses goals to:
 *   1. Evaluate whether current portfolio state meets targets
 *   2. Generate corrective actions when off-target
 *   3. Prioritise opportunities that move toward goal completion
 *
 * Portfolio allocation targets (from spec):
 *   - 50% Prediction Markets
 *   - 30% Yield (LP / lending)
 *   - 10% Liquidity Providing
 *   - 10% Reserve (XAU₮ hedge)
 *
 * @license Apache-2.0
 */

import { z } from "zod";

// ─── Schema ────────────────────────────────────────────────────────────────────

export const GoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Target allocation as a fraction of total portfolio (0–1). */
  targetAllocation: z.number().min(0).max(1),
  /** Current allocation (filled in by the Observe phase). */
  currentAllocation: z.number().min(0).max(1).default(0),
  /** Priority 1–5 (1 = highest). */
  priority: z.number().int().min(1).max(5),
  /** Whether goal is currently satisfied (within tolerance). */
  satisfied: z.boolean().default(false),
  /** Tolerance band around target (default: ±5%). */
  tolerance: z.number().min(0).max(0.5).default(0.05),
});

export type Goal = z.infer<typeof GoalSchema>;

export const GoalSetSchema = z.object({
  goals: z.array(GoalSchema),
  totalPortfolioUsdt: z.number(),
  evaluatedAt: z.string().datetime(),
});

export type GoalSet = z.infer<typeof GoalSetSchema>;

// ─── Static goal definitions ──────────────────────────────────────────────────

/** The agent's fixed strategic goals. Allocations must sum to 1.0. */
export const AGENT_GOALS: Omit<Goal, "currentAllocation" | "satisfied">[] = [
  {
    id: "prediction-markets",
    name: "Prediction Market Exposure",
    description:
      "Maintain 50% of portfolio in active prediction market positions. " +
      "Focus on markets with positive EV and probability 0.3–0.7.",
    targetAllocation: 0.5,
    priority: 1,
    tolerance: 0.05,
  },
  {
    id: "yield",
    name: "Yield Generation",
    description:
      "Maintain 30% of portfolio in yield-generating positions " +
      "(lending protocols, stable LP pairs). Minimum APR: 5%.",
    targetAllocation: 0.3,
    priority: 2,
    tolerance: 0.05,
  },
  {
    id: "liquidity-providing",
    name: "Liquidity Provision",
    description:
      "Maintain 10% in Uniswap V3 USDT/ETH LP positions to earn fees " +
      "and improve market depth.",
    targetAllocation: 0.1,
    priority: 3,
    tolerance: 0.05,
  },
  {
    id: "reserve",
    name: "XAU₮ Reserve",
    description:
      "Hold 10% in XAU₮ (Tether Gold) as an inflation hedge and " +
      "safe-haven reserve. Do not trade this allocation unless rebalancing.",
    targetAllocation: 0.1,
    priority: 4,
    tolerance: 0.03,
  },
];

// ─── Goal evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluates current goal satisfaction given the portfolio state.
 *
 * @param totalUsdt         - Total portfolio value in USD₮
 * @param predictionUsdt    - Value in prediction market positions
 * @param yieldUsdt         - Value in yield positions
 * @param lpUsdt            - Value in LP positions
 * @param reserveUsdt       - Value in XAU₮ reserve
 */
export function evaluateGoals(
  totalUsdt: number,
  predictionUsdt: number,
  yieldUsdt: number,
  lpUsdt: number,
  reserveUsdt: number
): GoalSet {
  const allocations = {
    "prediction-markets": totalUsdt > 0 ? predictionUsdt / totalUsdt : 0,
    yield: totalUsdt > 0 ? yieldUsdt / totalUsdt : 0,
    "liquidity-providing": totalUsdt > 0 ? lpUsdt / totalUsdt : 0,
    reserve: totalUsdt > 0 ? reserveUsdt / totalUsdt : 0,
  };

  const goals: Goal[] = AGENT_GOALS.map((g) => {
    const currentAllocation =
      allocations[g.id as keyof typeof allocations] ?? 0;
    const satisfied =
      Math.abs(currentAllocation - g.targetAllocation) <= g.tolerance;
    return { ...g, currentAllocation, satisfied };
  });

  return {
    goals,
    totalPortfolioUsdt: totalUsdt,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Returns goals that are currently NOT satisfied (off-target).
 * The planner focuses its action generation on these goals first.
 */
export function getUnsatisfiedGoals(goalSet: GoalSet): Goal[] {
  return goalSet.goals
    .filter((g) => !g.satisfied)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Returns a human-readable summary of goal satisfaction for LLM context.
 */
export function formatGoalSummary(goalSet: GoalSet): string {
  const lines = goalSet.goals.map((g) => {
    const pct = (g.currentAllocation * 100).toFixed(1);
    const target = (g.targetAllocation * 100).toFixed(0);
    const status = g.satisfied ? "OK" : "NEEDS REBALANCE";
    return `  - ${g.name}: ${pct}% (target ${target}%) [${status}]`;
  });
  return (
    `Portfolio $${goalSet.totalPortfolioUsdt.toFixed(2)} USD₮:\n` +
    lines.join("\n")
  );
}
