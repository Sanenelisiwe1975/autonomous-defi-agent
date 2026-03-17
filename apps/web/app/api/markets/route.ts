/**
 * @file app/api/markets/route.ts
 * @description GET /api/markets — reads live markets from MarketFactory on-chain.
 */

import { NextResponse } from "next/server";

const FACTORY_ABI = [
  "function getActiveMarkets() external view returns (address[])",
];

const MARKET_ABI = [
  "function question() external view returns (string)",
  "function closingTime() external view returns (uint256)",
  "function totalDeposited() external view returns (uint256)",
  "function resolvedOutcome() external view returns (uint8)",
  "function impliedYesProbability() external view returns (uint256)",
];

export async function GET() {
  const rpcUrl = process.env["RPC_URL"];
  const factoryAddress = process.env["MARKET_FACTORY_ADDRESS"];

  if (!rpcUrl || !factoryAddress) {
    return NextResponse.json({ markets: [] });
  }

  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const addresses: string[] = await factory.getActiveMarkets();

    const now = Math.floor(Date.now() / 1000);

    const markets = await Promise.all(
      addresses.map(async (addr) => {
        try {
          const m = new ethers.Contract(addr, MARKET_ABI, provider) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
          const [question, closingTime, totalDeposited, resolvedOutcome, impliedYesProb] =
            await Promise.all([
              m.question() as Promise<string>,
              m.closingTime() as Promise<bigint>,
              m.totalDeposited() as Promise<bigint>,
              m.resolvedOutcome() as Promise<number>,
              m.impliedYesProbability() as Promise<bigint>,
            ]);

          const yesProbability = Number(impliedYesProb) / 1e18;
          const tradeable = Number(resolvedOutcome) === 0 && Number(closingTime) > now;
          const closesAt = new Date(Number(closingTime) * 1000).toISOString();
          const volumeUsdt = (Number(totalDeposited) / 1e6).toFixed(2);

          return { address: addr, question, yesProbability, closesAt, volumeUsdt, tradeable, resolvedOutcome: Number(resolvedOutcome) };
        } catch {
          return null;
        }
      })
    );

    return NextResponse.json({ markets: markets.filter(Boolean) });
  } catch (err) {
    console.error("[/api/markets]", err);
    return NextResponse.json({ markets: [] });
  }
}
