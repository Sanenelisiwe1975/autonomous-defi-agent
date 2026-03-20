/**
 * @file observe.ts
 * @description OBSERVE phase — collect all market signals needed for planning.
 *
 * Fetches in parallel:
 *   1. Oracle prices (ETH, USDT, XAU) via Chainlink / CoinGecko
 *   2. Gas snapshot (EIP-1559 fee data)
 *   3. Portfolio snapshot (on-chain balances via WDK)
 *   4. Liquidity snapshots (Uniswap V3 pool + prediction markets)
 *   5. Available prediction market opportunities
 *
 * @license Apache-2.0
 */

import type { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import {
  fetchPrices,
  fetchGasSnapshot,
  fetchUsdtEthLiquidity,
  isUsdtDepegged,
  type OraclePrices,
  type GasSnapshot,
  type LiquiditySnapshot,
} from "@repo/data";
import { getPortfolioSnapshot, type PortfolioSnapshot } from "@repo/wdk";
import type { RawOpportunity } from "@repo/planner";
import { fetchActiveMarkets, getEthersSigner } from "./contracts.js";
import { ethers } from "ethers";


export interface ObserveResult {
  prices: OraclePrices;
  gas: GasSnapshot;
  portfolio: PortfolioSnapshot;
  liquidity: LiquiditySnapshot[];
  opportunities: RawOpportunity[];
  /** True if any risk gates are triggered (e.g. USDT depeg, network congested). */
  riskGatesTriggered: string[];
  /** Market addresses where the agent already holds a YES or NO position. */
  openPositionMarketIds: Set<string>;
  observedAt: string;
}

const VAULT_ABI = [
  "function agentWithdrawUsdt(uint256 amount, address to) external",
  "function usdtBalance() external view returns (uint256)",
  "function remainingDailyUsdt() external view returns (uint256)",
];
const USDT_BALANCE_ABI = ["function balanceOf(address) external view returns (uint256)"];

/** If agent USDT drops below 50 USDT, pull up to 100 USDT from AgentVault. */
async function topUpFromVault(rpcUrl: string): Promise<void> {
  const vaultAddress = process.env["AGENT_VAULT_ADDRESS"];
  const usdtAddress  = process.env["USDT_CONTRACT_ADDRESS"];
  if (!vaultAddress || !usdtAddress) return;

  try {
    const signer = getEthersSigner(rpcUrl);
    const agentAddress = await signer.getAddress();
    const usdt  = new ethers.Contract(usdtAddress, USDT_BALANCE_ABI, signer.provider!) as any;
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer) as any;

    const [agentUsdt, vaultUsdt, remainingDaily]: [bigint, bigint, bigint] = await Promise.all([
      usdt.balanceOf(agentAddress),
      vault.usdtBalance(),
      vault.remainingDailyUsdt(),
    ]);

    console.log(
      `[OBSERVE] Agent USDT: $${(Number(agentUsdt) / 1e6).toFixed(2)} | ` +
      `Vault: $${(Number(vaultUsdt) / 1e6).toFixed(2)} | ` +
      `Daily remaining: $${(Number(remainingDaily) / 1e6).toFixed(2)}`
    );

    const TOP_UP_THRESHOLD = 50_000_000n;
    const TOP_UP_TARGET    = 100_000_000n;
    if (agentUsdt >= TOP_UP_THRESHOLD) return;

    const needed     = TOP_UP_TARGET - agentUsdt;
    const canWithdraw = vaultUsdt < remainingDaily ? vaultUsdt : remainingDaily;
    const topUpAmount = needed < canWithdraw ? needed : canWithdraw;

    if (topUpAmount <= 0n) {
      console.warn("[OBSERVE] Vault cannot top up: insufficient vault balance or daily limit exhausted");
      return;
    }

    console.log(`[OBSERVE] Agent USDT low — withdrawing $${(Number(topUpAmount) / 1e6).toFixed(2)} from vault…`);
    const tx = await vault.agentWithdrawUsdt(topUpAmount, agentAddress);
    await tx.wait();
    console.log(`[OBSERVE] ✓ Vault top-up complete. TX: ${tx.hash}`);
  } catch (err) {
    console.warn("[OBSERVE] Vault top-up failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Discovers active prediction market opportunities.
 * Queries the deployed MarketFactory contract first; falls back to
 * simulated opportunities if no on-chain markets exist yet.
 */
async function discoverOpportunities(
  prices: OraclePrices,
  rpcUrl: string
): Promise<RawOpportunity[]> {
  const onChainMarkets = await fetchActiveMarkets(rpcUrl);

  if (onChainMarkets.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    return onChainMarkets
      .filter((m) => m.tradeable)
      .map((m) => {
        const tvlUsd = Number(m.totalDeposited) / 1e6;
        const blocksUntilClose = Math.max(0, Math.floor((m.closingTime - now) / 12));
        const yesEv = m.yesProbability * m.yesPayoutMultiplier - 1;
        const noEv = (1 - m.yesProbability) * m.noPayoutMultiplier - 1;
        const useYes = yesEv >= noEv;
        return {
          marketId: m.address,
          description: m.question,
          probability: useYes ? m.yesProbability : 1 - m.yesProbability,
          payoutMultiplier: useYes ? m.yesPayoutMultiplier : m.noPayoutMultiplier,
          tvlUsd,
          expiresInBlocks: blocksUntilClose,
        };
      });
  }

  const ethPrice = prices.eth.priceUsd;
  return [
    {
      marketId: "eth-above-3500-30d",
      description: `ETH price above $3,500 within 30 days (current: $${ethPrice.toFixed(0)})`,
      probability: ethPrice > 3200 ? 0.48 : 0.32,
      payoutMultiplier: 1.92,
      tvlUsd: 250_000,
      expiresInBlocks: 20_000,
    },
    {
      marketId: "usdt-peg-maintained-7d",
      description: "USDT maintains $0.999–$1.001 peg for 7 days",
      probability: 0.91,
      payoutMultiplier: 1.15,
      tvlUsd: 1_200_000,
      expiresInBlocks: 5_000,
    },
    {
      marketId: "xaut-above-2100-14d",
      description: "XAU₮ price above $2,100 within 14 days",
      probability: 0.41,
      payoutMultiplier: 2.60,
      tvlUsd: 85_000,
      expiresInBlocks: 10_000,
    },
    {
      marketId: "eth-gas-below-30-7d",
      description: "Ethereum average base fee below 30 gwei for 7 days",
      probability: 0.62,
      payoutMultiplier: 1.70,
      tvlUsd: 45_000,
      expiresInBlocks: 5_000,
    },
  ];
}

/**
 * Checks pre-execution risk conditions.
 * Returns a list of triggered gate names (empty = all clear).
 */
function checkRiskGates(
  prices: OraclePrices,
  gas: GasSnapshot
): string[] {
  const triggered: string[] = [];

  if (isUsdtDepegged(prices)) {
    triggered.push(
      `USDT_DEPEG: price at $${prices.usdt.priceUsd.toFixed(4)} (>0.5% deviation)`
    );
  }

  if (gas.baseFeeGwei > 100) {
    triggered.push(
      `EXTREME_GAS: base fee at ${gas.baseFeeGwei.toFixed(0)} gwei`
    );
  }

  if (prices.eth.priceUsd === 0) {
    triggered.push("ETH_PRICE_UNAVAILABLE: oracle returned 0");
  }

  return triggered;
}

/** Returns the set of market addresses where the agent already holds YES or NO tokens. */
async function fetchOpenPositionMarketIds(rpcUrl: string, agentAddress: string): Promise<Set<string>> {
  const open = new Set<string>();
  try {
    const markets = await fetchActiveMarkets(rpcUrl);
    if (!markets.length) return open;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    await Promise.all(markets.map(async (m) => {
      const yes = new ethers.Contract(m.yesTokenAddress, ERC20_ABI, provider) as any;
      const no  = new ethers.Contract(m.noTokenAddress,  ERC20_ABI, provider) as any;
      const [yBal, nBal]: [bigint, bigint] = await Promise.all([
        yes.balanceOf(agentAddress),
        no.balanceOf(agentAddress),
      ]);
      if (yBal > 0n || nBal > 0n) open.add(m.address);
    }));
  } catch { /* non-fatal */ }
  return open;
}

/**
 * Runs the full Observe phase — collects all signals needed for planning.
 *
 * @param account - WDK wallet account (for on-chain balance queries)
 * @param rpcUrl  - JSON-RPC endpoint
 * @param network - "mainnet" | "sepolia"
 */
export async function observe(
  account: WalletAccountEvm,
  rpcUrl: string,
  network: string
): Promise<ObserveResult> {
  console.log("[OBSERVE] Fetching market signals in parallel…");

  await topUpFromVault(rpcUrl);

  const prices = await fetchPrices(rpcUrl, network);
  const ethPriceUsd = prices.eth.priceUsd || 3000;

  const agentAddress = portfolio.address;

  const [gas, usdtEthLiquidity, opportunities] = await Promise.all([
    fetchGasSnapshot(rpcUrl, ethPriceUsd),
    fetchUsdtEthLiquidity(rpcUrl, network, ethPriceUsd),
    discoverOpportunities(prices, rpcUrl),
  ]);

  const openPositionMarketIds = await fetchOpenPositionMarketIds(rpcUrl, agentAddress);

  const riskGatesTriggered = checkRiskGates(prices, gas);

  if (riskGatesTriggered.length > 0) {
    console.warn("[OBSERVE] Risk gates triggered:", riskGatesTriggered);
  }

  console.log(
    `[OBSERVE] Fetched ${opportunities.length} opportunities | ` +
    `ETH $${prices.eth.priceUsd.toFixed(0)} | ` +
    `Gas ${gas.baseFeeGwei.toFixed(1)} gwei | ` +
    `Open positions: ${openPositionMarketIds.size}`
  );

  return {
    prices,
    gas,
    portfolio,
    liquidity: [usdtEthLiquidity],
    opportunities,
    riskGatesTriggered,
    openPositionMarketIds,
    observedAt: new Date().toISOString(),
  };
}
