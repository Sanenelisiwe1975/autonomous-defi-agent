/**
 * @file oracle.ts
 * @description On-chain price oracle via Chainlink AggregatorV3 feeds,
 * with a CoinGecko REST API fallback for when on-chain calls fail.
 *
 * Supported feeds (Ethereum / Sepolia):
 *   - ETH / USD
 *   - USDT / USD  (for depeg detection)
 *   - XAU / USD   (spot gold — proxy for XAU₮)
 *
 * All returned prices are plain JavaScript numbers in USD.
 *
 * @license Apache-2.0
 */

import { ethers } from "ethers";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriceData {
  /** Asset symbol (ETH, USDT, XAU). */
  symbol: string;
  /** Price in USD. */
  priceUsd: number;
  /** Unix timestamp of the feed round (seconds). */
  updatedAt: number;
  /** Data source: "chainlink" | "coingecko" | "fallback". */
  source: "chainlink" | "coingecko" | "fallback";
}

export interface OraclePrices {
  eth: PriceData;
  usdt: PriceData;
  xau: PriceData;
  fetchedAt: number;
}

// ─── Chainlink AggregatorV3 ABI (minimal) ─────────────────────────────────────

const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];

// ─── Feed addresses ───────────────────────────────────────────────────────────

/**
 * Chainlink price feed addresses by network.
 * Source: https://docs.chain.link/data-feeds/price-feeds/addresses
 */
const FEEDS: Record<string, Record<"eth" | "usdt" | "xau", string>> = {
  mainnet: {
    eth:  "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    usdt: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
    xau:  "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6",
  },
  sepolia: {
    // Chainlink has limited Sepolia feeds; using Ethereum Sepolia testnet feeds
    eth:  "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    usdt: "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19",
    xau:  "0x7b219F57a8e9C7303204Af681e9fA69d17ef626f",
  },
};

// ─── CoinGecko fallback ───────────────────────────────────────────────────────

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,tether,tether-gold&vs_currencies=usd";

interface CoinGeckoResponse {
  ethereum?: { usd: number };
  tether?: { usd: number };
  "tether-gold"?: { usd: number };
}

async function fetchCoinGeckoPrices(): Promise<OraclePrices> {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}`);
  }

  const data = (await res.json()) as CoinGeckoResponse;
  const now = Date.now();

  return {
    eth: {
      symbol: "ETH",
      priceUsd: data.ethereum?.usd ?? 0,
      updatedAt: Math.floor(now / 1000),
      source: "coingecko",
    },
    usdt: {
      symbol: "USDT",
      priceUsd: data.tether?.usd ?? 1,
      updatedAt: Math.floor(now / 1000),
      source: "coingecko",
    },
    xau: {
      symbol: "XAU",
      priceUsd: data["tether-gold"]?.usd ?? 0,
      updatedAt: Math.floor(now / 1000),
      source: "coingecko",
    },
    fetchedAt: now,
  };
}

// ─── Chainlink on-chain fetch ──────────────────────────────────────────────────

async function fetchChainlinkPrice(
  provider: ethers.JsonRpcProvider,
  feedAddress: string,
  symbol: string
): Promise<PriceData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feed = new ethers.Contract(feedAddress, AGGREGATOR_ABI, provider) as any;
  const decimals = (await feed.decimals()) as number;
  const roundData = (await feed.latestRoundData()) as [bigint, bigint, bigint, bigint, bigint];

  const answer = roundData[1]!;
  const updatedAt = roundData[3]!;
  const priceUsd = Number(answer) / 10 ** Number(decimals);

  return {
    symbol,
    priceUsd,
    updatedAt: Number(updatedAt),
    source: "chainlink",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches current prices for ETH, USDT, and XAU.
 *
 * Tries Chainlink on-chain feeds first; falls back to CoinGecko if the
 * RPC call fails (network issues, wrong chain, missing feed on testnet).
 *
 * @param rpcUrl  - JSON-RPC endpoint (same as WALLET_RPC_URL)
 * @param network - "mainnet" | "sepolia" (default: "sepolia")
 */
export async function fetchPrices(
  rpcUrl: string,
  network = "sepolia"
): Promise<OraclePrices> {
  const feeds = FEEDS[network] ?? FEEDS["sepolia"]!;

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const [eth, usdt, xau] = await Promise.all([
      fetchChainlinkPrice(provider, feeds.eth, "ETH"),
      fetchChainlinkPrice(provider, feeds.usdt, "USDT"),
      fetchChainlinkPrice(provider, feeds.xau, "XAU"),
    ]);

    return { eth, usdt, xau, fetchedAt: Date.now() };
  } catch (err) {
    console.warn(
      "[oracle] Chainlink fetch failed, falling back to CoinGecko:",
      err instanceof Error ? err.message : err
    );
    return fetchCoinGeckoPrices();
  }
}

/**
 * Checks for a USD₮ depeg (price deviating >0.5% from $1.00).
 * Used as a risk gate: the agent skips execution if USDT is depegged.
 */
export function isUsdtDepegged(prices: OraclePrices, thresholdPct = 0.5): boolean {
  const deviation = Math.abs(prices.usdt.priceUsd - 1.0) * 100;
  return deviation > thresholdPct;
}
