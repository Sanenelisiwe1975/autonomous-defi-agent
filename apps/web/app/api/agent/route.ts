/**
 * @file app/api/agent/route.ts
 * @description GET /api/agent — returns the latest agent state from Redis
 * or the JSON log file as a fallback.
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

interface AgentState {
  iteration: number;
  network: string;
  portfolio: {
    address: string;
    ethWei: string;
    usdtMicro: string;
    xautMicro: string;
    totalValueUsdt: string;
    snapshotAt: number;
  };
  lastCycleMs: number;
  executions: Array<{
    actionId: string;
    actionType: string;
    success: boolean;
    txHash?: string;
    feeWei?: string;
    error?: string;
    skipped: boolean;
    executedAt: string;
  }>;
  marketSentiment: string;
  updatedAt: string;
}

async function getFromRedis(): Promise<AgentState | null> {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return null;
  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: redisUrl });
    await client.connect();
    const raw = await client.get("agent:latest");
    await client.disconnect();
    return raw ? (JSON.parse(raw) as AgentState) : null;
  } catch {
    return null;
  }
}

async function getFromLog(): Promise<AgentState | null> {
  const logFile = path.join(process.cwd(), "../../packages/agent/data/agent-outcomes.jsonl");
  try {
    const content = await fs.readFile(logFile, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    const last = JSON.parse(lines[lines.length - 1]!);
    return {
      iteration: last.iteration as number,
      network: last.network as string,
      portfolio: last.portfolio as AgentState["portfolio"],
      lastCycleMs: last.durationMs as number,
      executions: last.executions as AgentState["executions"],
      marketSentiment: (last.plan as { marketSentiment: string }).marketSentiment,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const state = (await getFromRedis()) ?? (await getFromLog());

  if (!state) {
    return NextResponse.json(
      {
        iteration: 0,
        network: process.env["NETWORK"] ?? "sepolia",
        portfolio: null,
        lastCycleMs: 0,
        executions: [],
        marketSentiment: "NEUTRAL",
        updatedAt: new Date().toISOString(),
        status: "WAITING",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ ...state, status: "RUNNING" });
}
