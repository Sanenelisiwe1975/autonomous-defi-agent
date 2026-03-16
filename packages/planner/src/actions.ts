/**
 * @file actions.ts
 * @description Action type definitions and schemas for the OpenClaw planner.
 *
 * The planner produces a structured list of typed actions. These are then
 * passed to the Decide phase for EV evaluation and risk filtering, and
 * finally to the Execute phase for on-chain submission.
 *
 * @license Apache-2.0
 */

import { z } from "zod";

// ─── Schemas ───────────────────────────────────────────────────────────────────

const BaseActionSchema = z.object({
  /** Unique action ID (nanoid-style). */
  id: z.string(),
  /** Natural-language rationale from the LLM. */
  rationale: z.string(),
  /** LLM-estimated probability of success (0–1). */
  confidence: z.number().min(0).max(1),
  /** Urgency: how many blocks before this opportunity expires (0 = no expiry). */
  expiresInBlocks: z.number().int().min(0).default(0),
});

export const EnterMarketActionSchema = BaseActionSchema.extend({
  type: z.literal("ENTER_MARKET"),
  marketId: z.string(),
  marketDescription: z.string(),
  /** Outcome to bet on: "YES" | "NO". */
  outcome: z.enum(["YES", "NO"]),
  /** Amount to stake in micro-USDT (6 decimals). */
  amountMicroUsdt: z.bigint(),
  /** LLM-estimated probability of the chosen outcome (0–1). */
  probability: z.number().min(0).max(1),
  /** Expected payout multiplier (e.g. 1.8 = 80% return). */
  payoutMultiplier: z.number().positive(),
});

export const ExitMarketActionSchema = BaseActionSchema.extend({
  type: z.literal("EXIT_MARKET"),
  marketId: z.string(),
  /** Position token address to redeem. */
  positionTokenAddress: z.string(),
  /** Amount of position tokens to redeem. */
  amountTokens: z.bigint(),
});

export const RebalanceActionSchema = BaseActionSchema.extend({
  type: z.literal("REBALANCE"),
  /** Goal ID that is off-target. */
  goalId: z.string(),
  /** Token to sell (reduce allocation). */
  fromToken: z.enum(["USDT", "XAUT"]),
  /** Token to buy / deploy (increase allocation). */
  toAllocation: z.string(), // e.g. "yield", "prediction-markets"
  /** Amount to rebalance in micro-USDT. */
  amountMicroUsdt: z.bigint(),
});

export const HoldActionSchema = BaseActionSchema.extend({
  type: z.literal("HOLD"),
  reason: z.string(),
});

export const ActionSchema = z.discriminatedUnion("type", [
  EnterMarketActionSchema,
  ExitMarketActionSchema,
  RebalanceActionSchema,
  HoldActionSchema,
]);

export type EnterMarketAction = z.infer<typeof EnterMarketActionSchema>;
export type ExitMarketAction = z.infer<typeof ExitMarketActionSchema>;
export type RebalanceAction = z.infer<typeof RebalanceActionSchema>;
export type HoldAction = z.infer<typeof HoldActionSchema>;
export type AgentAction = z.infer<typeof ActionSchema>;

// ─── Action plan ──────────────────────────────────────────────────────────────

export const ActionPlanSchema = z.object({
  /** Overall rationale from the LLM. */
  summary: z.string(),
  /** Ordered list of proposed actions (highest priority first). */
  actions: z.array(ActionSchema),
  /** LLM's assessment of current market conditions. */
  marketSentiment: z.enum(["BULLISH", "BEARISH", "NEUTRAL", "VOLATILE"]),
  /** Whether the LLM recommends holding all positions this cycle. */
  recommendHold: z.boolean(),
  /** LLM reasoning chain (chain-of-thought). */
  reasoning: z.string(),
  /** Timestamp of plan generation. */
  generatedAt: z.string().datetime(),
});

export type ActionPlan = z.infer<typeof ActionPlanSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a simple action ID (timestamp + random suffix).
 */
export function generateActionId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Calculates raw Expected Value for an ENTER_MARKET action.
 * EV = (probability × payoutMultiplier) − 1
 *
 * Positive EV means the trade is mathematically profitable on average.
 * The result does NOT include gas costs — that deduction happens in decide.ts.
 */
export function calculateRawEV(action: EnterMarketAction): number {
  return action.probability * action.payoutMultiplier - 1;
}

/**
 * Converts micro-USDT bigint to a USD number string for display.
 */
export function microUsdtToDisplay(microUsdt: bigint): string {
  return `$${(Number(microUsdt) / 1e6).toFixed(2)} USD₮`;
}
