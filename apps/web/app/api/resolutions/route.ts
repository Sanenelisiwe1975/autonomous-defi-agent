import { NextResponse } from "next/server";

const FACTORY_ABI  = ["function getActiveMarkets() external view returns (address[])"];
const MARKET_ABI   = ["function question() external view returns (string)"];
const RESOLVER_ABI = [
  "function resolutions(bytes32 marketId) external view returns (uint8 outcome, uint8 source, uint256 timestamp, address resolvedBy, bool finalized)",
  "event ResolutionProposed(bytes32 indexed marketId, uint8 outcome, uint8 source, string rationale)",
];

const OUTCOME_LABEL = ["UNRESOLVED", "YES", "NO"];
const SOURCE_LABEL  = ["MULTISIG", "CHAINLINK", "UMA", "AI_ORACLE"];

async function fetchRationale(
  resolver: { queryFilter: (filter: unknown, from: number) => Promise<Array<{ args?: { rationale?: string } }>> },
  resolverContract: { filters: { ResolutionProposed: (marketId: string) => unknown } },
  marketId: string
): Promise<string | null> {
  try {
    const filter = resolverContract.filters.ResolutionProposed(marketId);
    const events = await resolver.queryFilter(filter, -5);
    const last = events[events.length - 1];
    return last?.args?.rationale ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const rpcUrl          = process.env["RPC_URL"];
  const factoryAddress  = process.env["MARKET_FACTORY_ADDRESS"];
  const resolverAddress = process.env["MARKET_RESOLVER_ADDRESS"];

  if (!rpcUrl || !factoryAddress || !resolverAddress) {
    return NextResponse.json({ resolutions: [] });
  }

  try {
    const { ethers } = await import("ethers");
    const provider  = new ethers.JsonRpcProvider(rpcUrl);
    const factory   = new ethers.Contract(factoryAddress, FACTORY_ABI, provider) as any;
    const resolver  = new ethers.Contract(resolverAddress, RESOLVER_ABI, provider) as any;

    const addresses: string[] = await factory.getActiveMarkets();

    const resolutions = await Promise.all(
      addresses.map(async (addr) => {
        try {
          const marketId = ethers.zeroPadValue(addr, 32);
          const market   = new ethers.Contract(addr, MARKET_ABI, provider) as any;

          const [question, res] = await Promise.all([
            market.question() as Promise<string>,
            resolver.resolutions(marketId) as Promise<{
              outcome: bigint; source: bigint; timestamp: bigint; resolvedBy: string; finalized: boolean;
            }>,
          ]);

          const outcome  = Number(res.outcome);
          const source   = Number(res.source);
          const ts       = Number(res.timestamp);
          const proposed = ts > 0;

          const rationale = proposed ? await fetchRationale(resolver, resolver, marketId) : null;

          return {
            marketAddress:     addr,
            marketId,
            question,
            proposed,
            outcome:           OUTCOME_LABEL[outcome] ?? "UNKNOWN",
            source:            SOURCE_LABEL[source]   ?? "UNKNOWN",
            resolvedBy:        res.resolvedBy,
            finalized:         res.finalized,
            rationale,
            proposedAt:        ts > 0 ? new Date(ts * 1000).toISOString() : null,
            disputeWindowEnds: ts > 0 ? new Date((ts + 86400) * 1000).toISOString() : null,
          };
        } catch {
          return null;
        }
      })
    );

    const cache = { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' };
    return NextResponse.json({ resolutions: resolutions.filter(Boolean) }, { headers: cache });
  } catch (err) {
    console.error("[/api/resolutions]", err);
    return NextResponse.json({ resolutions: [] });
  }
}
