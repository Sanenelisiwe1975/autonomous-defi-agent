import { NextResponse } from "next/server";

const FACTORY_ABI = ["function getActiveMarkets() external view returns (address[])"];

const MARKET_ABI = [
  "function question() external view returns (string)",
  "function closingTime() external view returns (uint256)",
  "function totalDeposited() external view returns (uint256)",
  "function resolvedOutcome() external view returns (uint8)",
  "function impliedYesProbability() external view returns (uint256)",
  "function yesToken() external view returns (address)",
  "function noToken() external view returns (address)",
];

const ERC20_ABI = ["function balanceOf(address) external view returns (uint256)"];

async function getAgentAddress(): Promise<string | null> {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return null;
  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: redisUrl });
    await client.connect();
    const raw = await client.get("agent:latest");
    await client.disconnect();
    if (!raw) return null;
    const state = JSON.parse(raw) as { portfolio?: { address?: string } };
    return state.portfolio?.address ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const rpcUrl         = process.env["RPC_URL"];
  const factoryAddress = process.env["MARKET_FACTORY_ADDRESS"];

  if (!rpcUrl || !factoryAddress) return NextResponse.json({ markets: [] });

  try {
    const { ethers } = await import("ethers");
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const factory    = new ethers.Contract(factoryAddress, FACTORY_ABI, provider) as any;
    const addresses: string[] = await factory.getActiveMarkets();
    const agentAddress = await getAgentAddress();
    const now = Math.floor(Date.now() / 1000);

    const markets = await Promise.all(
      addresses.map(async (addr) => {
        try {
          const m = new ethers.Contract(addr, MARKET_ABI, provider) as any;
          const [question, closingTime, totalDeposited, resolvedOutcome, impliedYesProb, yesToken, noToken] =
            await Promise.all([
              m.question()              as Promise<string>,
              m.closingTime()           as Promise<bigint>,
              m.totalDeposited()        as Promise<bigint>,
              m.resolvedOutcome()       as Promise<number>,
              m.impliedYesProbability() as Promise<bigint>,
              m.yesToken()              as Promise<string>,
              m.noToken()               as Promise<string>,
            ]);

          const yesProbability = Number(impliedYesProb) / 1e18;
          const closingTimeSec = Number(closingTime);
          const daysLeft       = Math.max(0, Math.ceil((closingTimeSec - now) / 86400));
          const tradeable      = Number(resolvedOutcome) === 0 && closingTimeSec > now;
          const closesAt       = new Date(closingTimeSec * 1000).toISOString();
          const volumeUsdt     = (Number(totalDeposited) / 1e6).toFixed(2);

          let agentYesUsdt: string | null = null;
          let agentNoUsdt:  string | null = null;

          if (agentAddress) {
            try {
              const yesTok = new ethers.Contract(yesToken, ERC20_ABI, provider) as any;
              const noTok  = new ethers.Contract(noToken,  ERC20_ABI, provider) as any;
              const [yBal, nBal] = await Promise.all([
                yesTok.balanceOf(agentAddress) as Promise<bigint>,
                noTok.balanceOf(agentAddress)  as Promise<bigint>,
              ]);
              if (yBal > 0n) agentYesUsdt = (Number(yBal) / 1e6).toFixed(2);
              if (nBal > 0n) agentNoUsdt  = (Number(nBal) / 1e6).toFixed(2);
            } catch { /* token read failed */ }
          }

          return {
            address: addr,
            question,
            yesProbability,
            closesAt,
            daysLeft,
            volumeUsdt,
            tradeable,
            resolvedOutcome: Number(resolvedOutcome),
            agentYesUsdt,
            agentNoUsdt,
          };
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
