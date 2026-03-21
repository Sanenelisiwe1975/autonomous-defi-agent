/**
 * @file app/api/agent/route.ts
 * @description GET /api/agent — returns the latest agent state from Redis
 * or the JSON log file as a fallback.
 */

import { NextResponse } from "next/server";

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
  reasoning: string;
  summary: string;
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


async function getGasGwei(): Promise<string | null> {
  const rpcUrl = process.env["RPC_URL"];
  if (!rpcUrl) return null;
  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const feeData = await provider.getFeeData();
    if (!feeData.gasPrice) return null;
    return (Number(feeData.gasPrice) / 1e9).toFixed(2);
  } catch {
    return null;
  }
}

export async function GET() {
  const [state, gasGwei] = await Promise.all([
    getFromRedis(),
    getGasGwei(),
  ]);

  if (!state) {
    return NextResponse.json(
      {
        iteration: 0,
        network: process.env["NETWORK"] ?? "sepolia",
        portfolio: null,
        lastCycleMs: 0,
        executions: [],
        marketSentiment: "NEUTRAL",
        reasoning: "",
        summary: "",
        gasGwei,
        updatedAt: new Date().toISOString(),
        status: "WAITING",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ ...state, gasGwei, status: "RUNNING" });
}
