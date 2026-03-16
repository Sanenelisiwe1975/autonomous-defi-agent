/**
 * @file index.ts
 * @description Autonomous DeFi Agent — main entry point.
 *
 * Implements the core agentic loop:
 *
 *   ┌─────────────┐
 *   │   OBSERVE   │  Collect market signals (prices, liquidity, gas, yield)
 *   └──────┬──────┘
 *          ▼
 *   ┌─────────────┐
 *   │   REASON    │  LLM + OpenClaw planner generates a structured action plan
 *   └──────┬──────┘
 *          ▼
 *   ┌─────────────┐
 *   │   DECIDE    │  EV = (probability × payout) − cost; risk filters applied
 *   └──────┬──────┘
 *          ▼
 *   ┌─────────────┐
 *   │   EXECUTE   │  WDK signs & broadcasts transactions non-custodially
 *   └──────┬──────┘
 *          ▼
 *   ┌─────────────┐
 *   │    LEARN    │  Outcome stored; priors updated for next iteration
 *   └─────────────┘
 *
 * The loop runs on a configurable interval (default: 60 s).
 * All wallet operations use @tetherto/wdk-wallet-evm via @repo/wdk.
 *
 * @license Apache-2.0
 */

import "dotenv/config";
import { createAgentWallet, formatPortfolio } from "@repo/wdk";
import { observe } from "./observe.js";
import { reason } from "./reason.js";
import { decide } from "./decide.js";
import { execute } from "./execute.js";
import { learn } from "./learn.js";

interface AgentConfig {
  loopIntervalMs: number;
  maxIterations: number | undefined;
  network: string;
  rpcUrl: string;
  dryRun: boolean;
}

function resolveConfig(): AgentConfig {
  const rpcUrl = process.env["RPC_URL"];
  if (!rpcUrl) throw new Error("Missing env var: RPC_URL");

  return {
    loopIntervalMs: parseInt(
      process.env["AGENT_LOOP_INTERVAL_MS"] ?? "60000",
      10
    ),
    maxIterations: process.env["AGENT_MAX_ITERATIONS"]
      ? parseInt(process.env["AGENT_MAX_ITERATIONS"], 10)
      : undefined,
    network: process.env["NETWORK"] ?? "sepolia",
    rpcUrl,
    dryRun: process.env["AGENT_DRY_RUN"] !== "false",
  };
}

async function runCycle(
  wallet: ReturnType<typeof createAgentWallet>,
  config: AgentConfig,
  iteration: number
): Promise<void> {
  const cycleStart = Date.now();

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `[AGENT] Cycle #${iteration} — ${new Date().toISOString()} — ${config.network}`
  );
  console.log(`${"─".repeat(60)}`);

  const account = await wallet.getPrimaryAccount();

  const signals = await observe(account, config.rpcUrl, config.network);

  const display = formatPortfolio(signals.portfolio);
  console.log(`[PORTFOLIO] ${display.address}`);
  console.log(`  ETH:  ${display.ethBalance}`);
  console.log(`  USDT: ${display.usdtBalance}`);
  console.log(`  XAUT: ${display.xautBalance}`);

  const plan = await reason(signals, config.rpcUrl);

  const decision = decide(plan, signals);

  const executions = await execute(decision, account, config.dryRun, config.rpcUrl);

  await learn({
    iteration,
    network: config.network,
    durationMs: Date.now() - cycleStart,
    signals,
    plan,
    decision,
    executions,
    portfolio: signals.portfolio,
  });
}


async function main(): Promise<void> {
  const config = resolveConfig();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       Autonomous DeFi Agent — Tether WDK Edition        ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Network:        ${config.network}`);
  console.log(`RPC:            ${config.rpcUrl.slice(0, 40)}…`);
  console.log(`Loop interval:  ${config.loopIntervalMs / 1000}s`);
  console.log(`Dry run:        ${config.dryRun}`);
  console.log(`Max iterations: ${config.maxIterations ?? "∞"}`);

  const wallet = createAgentWallet();
  const address = await wallet.getAddress(0);
  console.log(`Agent address:  ${address}`);
  console.log();

  let iteration = 0;

  const shutdown = () => {
    console.log("\n[AGENT] Shutting down — disposing wallet keys…");
    wallet.dispose();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    iteration++;

    try {
      await runCycle(wallet, config, iteration);
    } catch (err) {
      console.error(
        `[AGENT] Unhandled error in cycle #${iteration}:`,
        err instanceof Error ? err.stack : err
      );
      // Continue — transient RPC / network errors must not kill the agent
    }

    if (
      config.maxIterations !== undefined &&
      iteration >= config.maxIterations
    ) {
      console.log(
        `[AGENT] Reached max iterations (${config.maxIterations}). Stopping.`
      );
      shutdown();
    }

    console.log(
      `[AGENT] Sleeping ${config.loopIntervalMs / 1000}s until next cycle…`
    );
    await new Promise((resolve) => setTimeout(resolve, config.loopIntervalMs));
  }
}

main().catch((err) => {
  console.error("[AGENT] Fatal startup error:", err);
  process.exit(1);
});
