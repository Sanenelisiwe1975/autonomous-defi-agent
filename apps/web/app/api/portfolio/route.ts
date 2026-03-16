/**
 * @file app/api/portfolio/route.ts
 * @description GET /api/portfolio — returns last 50 portfolio snapshots from PostgreSQL.
 */

import { NextResponse } from "next/server";

interface PortfolioRow {
  id: number;
  address: string;
  eth_wei: string;
  usdt_micro: string;
  xaut_micro: string;
  total_usdt: string;
  snapshot_at: string;
}

async function getFromPostgres(): Promise<PortfolioRow[]> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) return [];
  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const { rows } = await client.query<PortfolioRow>(
      `SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 50`
    );
    await client.end();
    return rows.reverse(); // oldest first for chart
  } catch {
    return [];
  }
}

export async function GET() {
  const rows = await getFromPostgres();
  const snapshots = rows.map((r) => ({
    id: r.id,
    address: r.address,
    ethBalance: (Number(r.eth_wei) / 1e18).toFixed(6),
    usdtBalance: (Number(r.usdt_micro) / 1e6).toFixed(2),
    xautBalance: (Number(r.xaut_micro) / 1e6).toFixed(6),
    totalUsdt: (Number(r.total_usdt) / 1e6).toFixed(2),
    snapshotAt: r.snapshot_at,
  }));
  return NextResponse.json({ snapshots });
}
