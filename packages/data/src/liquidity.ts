/**
 * @file liquidity.ts
 * @description On-chain liquidity depth queries for prediction markets
 * and Uniswap V3 pools.
 *
 * Used in the Observe phase to determine:
 *   - Whether a market has sufficient liquidity to enter/exit
 *   - Estimated price impact for the agent's position size
 *   - Available yield opportunities in LP pools
 *
 * @license Apache-2.0
 */

import { ethers } from "ethers";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiquiditySnapshot {
  /** Market or pool identifier. */
  id: string;
  /** Total locked value in USD (approximation). */
  tvlUsd: number;
  /** Available liquidity for swaps/bets in USD. */
  availableLiquidityUsd: number;
  /** Estimated price impact (%) for a $100 trade. */
  priceImpact100Usd: number;
  /** Annual percentage yield (for LP positions, 0 if not applicable). */
  aprPct: number;
  /** Unix timestamp of snapshot. */
  snapshotAt: number;
}

export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number; // Uniswap fee tier in bps (e.g. 500 = 0.05%)
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
}

// ─── Uniswap V3 Pool ABI (minimal) ───────────────────────────────────────────

const UNISWAP_POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
];

// ─── Known USDT/ETH Uniswap V3 pool addresses ─────────────────────────────────

const USDT_ETH_POOLS: Record<string, string> = {
  mainnet: "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36", // USDT/WETH 0.05%
  sepolia: "", // No official Uniswap V3 on Sepolia — use mock
};

// ─── Pool liquidity query ─────────────────────────────────────────────────────

/**
 * Fetches on-chain pool state for a Uniswap V3 pool.
 * Returns null if the pool address is not set (testnet).
 */
async function fetchPoolInfo(
  provider: ethers.JsonRpcProvider,
  poolAddress: string
): Promise<PoolInfo | null> {
  if (!poolAddress) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pool = new ethers.Contract(poolAddress, UNISWAP_POOL_ABI, provider) as any;
    const slot0 = (await pool.slot0()) as [bigint, number];
    const liquidity = (await pool.liquidity()) as bigint;
    const token0 = (await pool.token0()) as string;
    const token1 = (await pool.token1()) as string;
    const fee = (await pool.fee()) as number;

    return {
      address: poolAddress,
      token0: token0 as string,
      token1: token1 as string,
      fee: Number(fee),
      sqrtPriceX96: slot0[0] as bigint,
      liquidity: liquidity as bigint,
      tick: Number(slot0[1]),
    };
  } catch {
    return null;
  }
}

/**
 * Estimates USD TVL from Uniswap V3 pool liquidity.
 * This is a rough approximation — accurate TVL requires full tick math.
 *
 * @param liquidity - Raw pool liquidity (uint128)
 * @param ethPriceUsd - Current ETH/USD price
 */
function estimateTvlUsd(liquidity: bigint, ethPriceUsd: number): number {
  // Simplified: treat liquidity units as proportional to TVL
  // Real implementation would use the full concentrated liquidity formula
  return (Number(liquidity) / 1e12) * ethPriceUsd * 2;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a liquidity snapshot for the USDT/ETH Uniswap V3 pool.
 * Falls back to mock data on testnet.
 *
 * @param rpcUrl      - JSON-RPC endpoint
 * @param network     - "mainnet" | "sepolia"
 * @param ethPriceUsd - Current ETH price in USD (from oracle)
 */
export async function fetchUsdtEthLiquidity(
  rpcUrl: string,
  network: string,
  ethPriceUsd: number
): Promise<LiquiditySnapshot> {
  const poolAddress = USDT_ETH_POOLS[network] ?? "";
  const now = Date.now();

  if (!poolAddress) {
    // Return plausible mock data for testnet development
    return {
      id: "usdt-eth-uniswap-v3",
      tvlUsd: 150_000_000,
      availableLiquidityUsd: 80_000_000,
      priceImpact100Usd: 0.001,
      aprPct: 12.4,
      snapshotAt: now,
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const pool = await fetchPoolInfo(provider, poolAddress);

  if (!pool) {
    return {
      id: "usdt-eth-uniswap-v3",
      tvlUsd: 0,
      availableLiquidityUsd: 0,
      priceImpact100Usd: 999,
      aprPct: 0,
      snapshotAt: now,
    };
  }

  const tvlUsd = estimateTvlUsd(pool.liquidity, ethPriceUsd);

  return {
    id: "usdt-eth-uniswap-v3",
    tvlUsd,
    availableLiquidityUsd: tvlUsd * 0.5,
    priceImpact100Usd: tvlUsd > 0 ? (100 / tvlUsd) * 100 : 999,
    aprPct: pool.fee / 100, // very rough APR proxy from fee tier
    snapshotAt: now,
  };
}

const PREDICTION_MARKET_LIQUIDITY_ABI = [
  "function yesReserve() external view returns (uint256)",
  "function noReserve() external view returns (uint256)",
  "function totalDeposited() external view returns (uint256)",
  "function quoteEnterPosition(bool isYes, uint256 usdtIn) external view returns (uint256 tokensOut)",
];

/**
 * Fetches real liquidity snapshots from deployed PredictionMarket contracts.
 * Falls back to mock data for market IDs that are not Ethereum addresses.
 *
 * @param marketIds - List of market addresses or string IDs
 * @param rpcUrl    - JSON-RPC endpoint
 */
export async function fetchPredictionMarketLiquidity(
  marketIds: string[],
  rpcUrl?: string
): Promise<LiquiditySnapshot[]> {
  if (!rpcUrl) {
    return marketIds.map((id) => ({
      id, tvlUsd: 50_000, availableLiquidityUsd: 10_000,
      priceImpact100Usd: 0.2, aprPct: 0, snapshotAt: Date.now(),
    }));
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const now = Date.now();

  return Promise.all(
    marketIds.map(async (id): Promise<LiquiditySnapshot> => {
      // Only query on-chain if the ID looks like an address
      if (!ethers.isAddress(id)) {
        return { id, tvlUsd: 50_000, availableLiquidityUsd: 10_000, priceImpact100Usd: 0.2, aprPct: 0, snapshotAt: now };
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const market = new ethers.Contract(id, PREDICTION_MARKET_LIQUIDITY_ABI, provider) as any;
        const [yesReserve, noReserve, totalDeposited]: [bigint, bigint, bigint] = await Promise.all([
          market.yesReserve(),
          market.noReserve(),
          market.totalDeposited(),
        ]);
        const tvlUsd = Number(totalDeposited) / 1e6;
        const availableLiquidityUsd = Number(yesReserve + noReserve) / 1e6;
        // Estimate price impact: 100 USD / TVL as rough %, capped at 10%
        const priceImpact100Usd = tvlUsd > 0 ? Math.min((100 / tvlUsd) * 100, 10) : 10;
        return { id, tvlUsd, availableLiquidityUsd, priceImpact100Usd, aprPct: 0, snapshotAt: now };
      } catch {
        return { id, tvlUsd: 0, availableLiquidityUsd: 0, priceImpact100Usd: 10, aprPct: 0, snapshotAt: now };
      }
    })
  );
}

/**
 * Checks whether a market has sufficient liquidity to absorb the agent's position.
 *
 * @param snapshot       - Liquidity snapshot for the market
 * @param positionSizeUsd - Intended position size in USD
 * @param maxImpactPct    - Maximum acceptable price impact (default: 1%)
 */
export function hasSufficientLiquidity(
  snapshot: LiquiditySnapshot,
  positionSizeUsd: number,
  maxImpactPct = 1.0
): boolean {
  if (snapshot.availableLiquidityUsd < positionSizeUsd) return false;
  const estimatedImpact =
    (positionSizeUsd / snapshot.tvlUsd) * 100 * snapshot.priceImpact100Usd;
  return estimatedImpact <= maxImpactPct;
}
