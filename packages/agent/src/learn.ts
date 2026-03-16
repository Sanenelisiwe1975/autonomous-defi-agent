/**
 * @file learn.ts
 * @description LEARN phase — persist outcomes and update agent priors.
 *
 * Each loop iteration's outcome is written to:
 *   1. PostgreSQL (full history — loop_outcomes, trades, portfolio_snapshots)
 *   2. Redis (latest state cache — consumed by the Next.js dashboard)
 *
 * If neither is configured, outcomes are written to a local JSON log file
 * (safe for development without Docker).
 *
 * @license Apache-2.0
 */

import fs from "fs/promises";
import path from "path";
import type { ActionPlan } from "@repo/planner";
import type { PortfolioSnapshot } from "@repo/wdk";
import type { ObserveResult } from "./observe.js";
import type { DecisionResult } from "./decide.js";
import type { ExecutionResult } from "./execute.js";


export interface LoopOutcome {
  iteration: number;
  network: string;
  durationMs: number;
  signals: ObserveResult;
  plan: ActionPlan;
  decision: DecisionResult;
  executions: ExecutionResult[];
  portfolio: PortfolioSnapshot;
}


const LOG_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(LOG_DIR, "agent-outcomes.jsonl");

async function writeJsonLog(outcome: LoopOutcome): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  // Serialize bigints as strings
  const line =
    JSON.stringify(outcome, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    ) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");
}


async function writeToPostgres(outcome: LoopOutcome): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) return;

  // Lazy import pg to avoid hard dependency when not configured
  try {
    const { default: pg } = await import("pg" as string) as { default: typeof import("pg") };
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      // Serialize bigints
      const serialize = (obj: unknown): string =>
        JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

      // Insert loop outcome
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO loop_outcomes (iteration, network, duration_ms, signals, plan, decision, executions, portfolio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          outcome.iteration,
          outcome.network,
          outcome.durationMs,
          serialize(outcome.signals),
          serialize(outcome.plan),
          serialize(outcome.decision),
          serialize(outcome.executions),
          serialize(outcome.portfolio),
        ]
      );

      const outcomeId = rows[0]?.id;

      // Insert individual trades
      for (const exec of outcome.executions) {
        await client.query(
          `INSERT INTO trades (loop_outcome_id, action_type, tx_hash, fee_wei, success, error, executed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            outcomeId,
            exec.actionType,
            exec.txHash ?? null,
            exec.feeWei?.toString() ?? null,
            exec.success,
            exec.error ?? null,
            exec.executedAt,
          ]
        );
      }

      // Insert portfolio snapshot
      await client.query(
        `INSERT INTO portfolio_snapshots (address, eth_wei, usdt_micro, xaut_micro, total_usdt)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          outcome.portfolio.address,
          outcome.portfolio.ethWei.toString(),
          outcome.portfolio.usdtMicro.toString(),
          outcome.portfolio.xautMicro.toString(),
          outcome.portfolio.totalValueUsdt.toString(),
        ]
      );
    } finally {
      await client.end();
    }
  } catch (err) {
    console.warn("[LEARN] PostgreSQL write failed:", err instanceof Error ? err.message : err);
  }
}


async function writeToRedis(outcome: LoopOutcome): Promise<void> {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return;

  try {
    const { createClient } = await import("redis" as string) as { createClient: typeof import("redis")["createClient"] };
    const client = createClient({ url: redisUrl });
    await client.connect();

    try {
      const serialize = (obj: unknown): string =>
        JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

      await client.set(
        "agent:latest",
        serialize({
          iteration: outcome.iteration,
          network: outcome.network,
          portfolio: outcome.portfolio,
          lastCycleMs: outcome.durationMs,
          executions: outcome.executions,
          marketSentiment: outcome.plan.marketSentiment,
          updatedAt: new Date().toISOString(),
        }),
        { EX: 300 } // 5-minute TTL
      );

      // Publish event for WebSocket consumers
      await client.publish(
        "agent:events",
        serialize({ type: "CYCLE_COMPLETE", iteration: outcome.iteration })
      );
    } finally {
      await client.disconnect();
    }
  } catch (err) {
    console.warn("[LEARN] Redis write failed:", err instanceof Error ? err.message : err);
  }
}


interface MarketPrior {
  /** Number of times we entered this market. */
  attempts: number;
  /** Number of successful (non-failed, non-skipped) executions. */
  successes: number;
  /** Bayesian estimate of success probability (Beta distribution mean). */
  estimatedSuccessRate: number;
  /** Total gas cost observed across all executions (wei as string). */
  totalGasWei: string;
  lastUpdated: string;
}

interface PriorStore {
  markets: Record<string, MarketPrior>;
  globalSuccessRate: number;
  totalCycles: number;
  updatedAt: string;
}

const PRIORS_FILE = path.join(process.cwd(), "data", "priors.json");

async function loadPriors(): Promise<PriorStore> {
  try {
    const raw = await fs.readFile(PRIORS_FILE, "utf8");
    return JSON.parse(raw) as PriorStore;
  } catch {
    return { markets: {}, globalSuccessRate: 0.5, totalCycles: 0, updatedAt: new Date().toISOString() };
  }
}

async function savePriors(store: PriorStore): Promise<void> {
  await fs.mkdir(path.dirname(PRIORS_FILE), { recursive: true });
  await fs.writeFile(PRIORS_FILE, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Updates Bayesian priors using a Beta distribution update rule.
 * Prior: Beta(α, β) where α = successes + 1, β = failures + 1
 * Posterior mean = α / (α + β)
 */
async function updatePriors(outcome: LoopOutcome): Promise<void> {
  const store = await loadPriors();
  store.totalCycles += 1;

  const executed = outcome.executions.filter((e) => !e.skipped);
  if (!executed.length) {
    store.updatedAt = new Date().toISOString();
    await savePriors(store);
    return;
  }

  // Update per-action priors
  for (const exec of executed) {
    const key = exec.actionType;
    const prior = store.markets[key] ?? { attempts: 0, successes: 0, estimatedSuccessRate: 0.5, totalGasWei: "0", lastUpdated: "" };
    prior.attempts += 1;
    if (exec.success) prior.successes += 1;
    // Beta distribution posterior mean: (successes + 1) / (attempts + 2)
    prior.estimatedSuccessRate = (prior.successes + 1) / (prior.attempts + 2);
    prior.totalGasWei = (BigInt(prior.totalGasWei) + (exec.feeWei ?? 0n)).toString();
    prior.lastUpdated = new Date().toISOString();
    store.markets[key] = prior;
  }

  const globalSuccesses = executed.filter((e) => e.success).length;
  // Exponential moving average of global success rate
  store.globalSuccessRate = 0.8 * store.globalSuccessRate + 0.2 * (globalSuccesses / executed.length);

  const successRate = globalSuccesses / executed.length;
  console.log(`[LEARN] Success rate this cycle: ${(successRate * 100).toFixed(0)}% | Global EMA: ${(store.globalSuccessRate * 100).toFixed(1)}%`);

  store.updatedAt = new Date().toISOString();
  await savePriors(store);
}


/**
 * Runs the Learn phase — persists the loop outcome and updates priors.
 *
 * @param outcome - Complete output from a single agent loop cycle
 */
export async function learn(outcome: LoopOutcome): Promise<void> {
  const { iteration, durationMs, executions } = outcome;

  const succeeded = executions.filter((e) => e.success && !e.skipped).length;
  const failed = executions.filter((e) => !e.success).length;
  const skipped = executions.filter((e) => e.skipped).length;

  console.log(
    `[LEARN] Cycle #${iteration} | ${durationMs}ms | ` +
    `Executions: ${succeeded} ok, ${failed} failed, ${skipped} skipped`
  );

  await Promise.allSettled([
    writeJsonLog(outcome),
    writeToPostgres(outcome),
    writeToRedis(outcome),
    updatePriors(outcome),
  ]);
}
