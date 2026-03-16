/**
 * @file app/api/trades/route.ts
 * @description GET /api/trades — returns last 20 trade executions from PostgreSQL.
 */

import { NextResponse } from "next/server";

interface TradeRow {
  id: number;
  loop_outcome_id: number;
  action_type: string;
  market_id: string | null;
  token: string | null;
  amount_micro: string | null;
  tx_hash: string | null;
  fee_wei: string | null;
  success: boolean;
  error: string | null;
  executed_at: string;
}

async function getFromPostgres(): Promise<TradeRow[]> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) return [];
  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const { rows } = await client.query<TradeRow>(
      `SELECT * FROM trades ORDER BY executed_at DESC LIMIT 20`
    );
    await client.end();
    return rows;
  } catch {
    return [];
  }
}

export async function GET() {
  const rows = await getFromPostgres();
  const trades = rows.map((r) => ({
    id: r.id,
    actionType: r.action_type,
    txHash: r.tx_hash,
    feeEth: r.fee_wei ? (Number(r.fee_wei) / 1e18).toFixed(8) : null,
    success: r.success,
    error: r.error,
    executedAt: r.executed_at,
  }));
  return NextResponse.json({ trades });
}
