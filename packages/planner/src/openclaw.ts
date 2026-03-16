/**
 * @file openclaw.ts
 * @description OpenClaw — the LangChain.js planning engine.
 *
 * OpenClaw takes raw market signals, formats them into a structured
 * LLM prompt, and returns a validated ActionPlan using GPT-4o with
 * JSON-mode output. The plan is then consumed by the agent's Decide phase.
 *
 * Architecture:
 *   MarketContext → SystemPrompt + UserMessage → ChatOpenAI (JSON mode)
 *                → Zod validation → ActionPlan
 *
 * @license Apache-2.0
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import type { OraclePrices, GasSnapshot, LiquiditySnapshot } from "@repo/data";
import {
  ActionPlanSchema,
  generateActionId,
  type ActionPlan,
} from "./actions.js";
import { type GoalSet, evaluateGoals } from "./goals.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import {
  buildPlanningMessage,
  type RawOpportunity,
} from "./prompts/planning.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlannerInput {
  prices: OraclePrices;
  gas: GasSnapshot;
  opportunities: RawOpportunity[];
  liquidity: LiquiditySnapshot[];
  /** Current portfolio balances. */
  portfolio: {
    ethWei: bigint;
    usdtMicro: bigint;
    xautMicro: bigint;
    /** Approx. value in prediction markets (micro-USDT). */
    predictionPositionsMicro: bigint;
    /** Approx. value in yield positions (micro-USDT). */
    yieldPositionsMicro: bigint;
    /** Approx. value in LP positions (micro-USDT). */
    lpPositionsMicro: bigint;
  };
}

export interface PlannerConfig {
  model?: string;
  temperature?: number;
  /** Whether to run in mock mode (no API calls). */
  mock?: boolean;
}

// ─── OpenClaw planner ─────────────────────────────────────────────────────────

/**
 * The OpenClaw planner uses LangChain.js to call GPT-4o with structured
 * JSON output. It converts raw market signals into a validated ActionPlan.
 */
export class OpenClawPlanner {
  private readonly llm: ChatAnthropic;
  private readonly config: Required<PlannerConfig>;

  constructor(config: PlannerConfig = {}) {
    this.config = {
      model: config.model ?? process.env["LLM_MODEL"] ?? "claude-sonnet-4-6",
      temperature: config.temperature ??
        parseFloat(process.env["LLM_TEMPERATURE"] ?? "0.2"),
      mock: config.mock ?? process.env["ANTHROPIC_API_KEY"] === undefined,
    };

    this.llm = new ChatAnthropic({
      model: this.config.model,
      temperature: this.config.temperature,
    });
  }

  /**
   * Generates a structured action plan from market signals.
   * Returns a mock plan if OPENAI_API_KEY is not set (safe for dev).
   *
   * @param input - Market signals, portfolio state, and opportunities
   */
  async plan(input: PlannerInput): Promise<ActionPlan> {
    if (this.config.mock) {
      return this.mockPlan(input);
    }

    const goalSet = this.evaluateGoals(input);
    const userMessage = buildPlanningMessage({
      prices: input.prices,
      gas: input.gas,
      goalSet,
      opportunities: input.opportunities,
      liquidity: input.liquidity,
      ethWei: input.portfolio.ethWei,
    });

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userMessage),
    ];

    let rawJson: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.llm.invoke(messages as any);
      rawJson = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    } catch (err) {
      console.error("[OpenClaw] LLM call failed:", err);
      return this.mockPlan(input);
    }

    return this.parseAndValidate(rawJson, input);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private evaluateGoals(input: PlannerInput): GoalSet {
    const total = Number(input.portfolio.usdtMicro) / 1e6;
    const prediction = Number(input.portfolio.predictionPositionsMicro) / 1e6;
    const yieldVal = Number(input.portfolio.yieldPositionsMicro) / 1e6;
    const lp = Number(input.portfolio.lpPositionsMicro) / 1e6;
    // XAU₮ converted to USD at current price
    const xautUsd =
      (Number(input.portfolio.xautMicro) / 1e6) * input.prices.xau.priceUsd;

    return evaluateGoals(total + xautUsd, prediction, yieldVal, lp, xautUsd);
  }

  private parseAndValidate(rawJson: string, input: PlannerInput): ActionPlan {
    try {
      // Strip markdown code fences if Claude wraps the response
      const cleaned = rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/,"").trim();
      const parsed: unknown = JSON.parse(cleaned);
      // Ensure actions have IDs and required fields
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "actions" in parsed &&
        Array.isArray((parsed as { actions: unknown[] }).actions)
      ) {
        const p = parsed as { actions: Array<Record<string, unknown>>; generatedAt?: unknown };
        p.actions = p.actions.map((a) => ({
          ...a,
          id: typeof a["id"] === "string" ? a["id"] : generateActionId(),
          amountMicroUsdt: a["amountMicroUsdt"]
            ? BigInt(a["amountMicroUsdt"] as string | number)
            : 10_000_000n,
        }));
        p.generatedAt = new Date().toISOString();
      }
      return ActionPlanSchema.parse(parsed);
    } catch (err) {
      console.warn("[OpenClaw] Failed to parse LLM response, using mock plan:", err);
      return this.mockPlan(input);
    }
  }

  /**
   * Returns a deterministic mock plan for development / testing.
   * Always includes a HOLD action so the agent loop can run without an API key.
   */
  private mockPlan(input: PlannerInput): ActionPlan {
    const goalSet = this.evaluateGoals(input);
    const bestOpp = input.opportunities
      .filter((o) => o.probability * o.payoutMultiplier - 1 > 0.02)
      .sort((a, b) => b.probability * b.payoutMultiplier - a.probability * a.payoutMultiplier)[0];

    const actions = [];

    if (bestOpp) {
      const ev = bestOpp.probability * bestOpp.payoutMultiplier - 1;
      actions.push({
        id: generateActionId(),
        type: "ENTER_MARKET" as const,
        marketId: bestOpp.marketId,
        marketDescription: bestOpp.description,
        outcome: "YES" as const,
        amountMicroUsdt: 10_000_000n, // $10 position
        probability: bestOpp.probability,
        payoutMultiplier: bestOpp.payoutMultiplier,
        rationale: `Positive EV of ${(ev * 100).toFixed(1)}% detected. Entering minimum position.`,
        confidence: bestOpp.probability,
        expiresInBlocks: bestOpp.expiresInBlocks,
      });
    }

    actions.push({
      id: generateActionId(),
      type: "HOLD" as const,
      reason: "Mock plan: holding remaining portfolio pending real LLM integration.",
      rationale: "No high-confidence opportunities beyond the above.",
      confidence: 1,
      expiresInBlocks: 0,
    });

    const offTarget = goalSet.goals.filter((g) => !g.satisfied);

    return {
      summary: `Mock plan cycle. ${offTarget.length > 0 ? `${offTarget.length} goal(s) off-target.` : "All goals on-target."}`,
      actions,
      marketSentiment: "NEUTRAL",
      recommendHold: actions.length === 1,
      reasoning:
        "Mock plan generated (ANTHROPIC_API_KEY not set or LLM unavailable). " +
        "Set ANTHROPIC_API_KEY in .env to enable real LLM planning.",
      generatedAt: new Date().toISOString(),
    };
  }
}

// ─── Singleton factory ─────────────────────────────────────────────────────────

let _planner: OpenClawPlanner | null = null;

/**
 * Returns the singleton OpenClaw planner instance.
 * Creates it on first call.
 */
export function getPlanner(config?: PlannerConfig): OpenClawPlanner {
  if (!_planner) {
    _planner = new OpenClawPlanner(config);
  }
  return _planner;
}
