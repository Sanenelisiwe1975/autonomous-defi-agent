/**
 * seed-markets.mjs
 * Deploys a batch of diverse prediction markets via the deployed MarketFactory.
 *
 * Usage (from packages/contracts):
 *   node scripts/seed-markets.mjs
 *
 * Reads from .env in this directory.
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim()))
);

const RPC_URL         = envVars["RPC_URL"];
const PRIVATE_KEY     = envVars["DEPLOYER_PRIVATE_KEY"];
const FACTORY_ADDRESS = envVars["MARKET_FACTORY_ADDRESS"];
const USDT_ADDRESS    = envVars["USDT_CONTRACT_ADDRESS"] ?? "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";

if (!RPC_URL || !PRIVATE_KEY || !FACTORY_ADDRESS) {
  console.error("Missing RPC_URL, DEPLOYER_PRIVATE_KEY, or MARKET_FACTORY_ADDRESS in .env");
  process.exit(1);
}

const FACTORY_ABI = [
  "function createMarket(string calldata question_, uint256 closingTime_, uint256 initialYesUsdt, uint256 initialNoUsdt) external returns (address market)",
  "event MarketCreated(address indexed market, string question, uint256 closingTime, address creator)",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const usdt     = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, wallet);
const factory  = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);
const iface    = new ethers.Interface(FACTORY_ABI);

// Seed each side with 0 USDT — markets start empty, agent provides liquidity on entry.
// Set to 5_000_000n if your deployer wallet holds mintable test USDT with approve rights.
const SEED = 0n;

const now = Math.floor(Date.now() / 1000);
const days = (n) => now + n * 86400;

// 10 diverse markets across Crypto, Macro, DeFi, Politics, Science
const MARKETS = [
  // ── Crypto ──────────────────────────────────────────────────────────────
  {
    question: "Will ETH price exceed $3,000 before April 20, 2026?",
    closingTime: days(31),
    category: "Crypto",
  },
  {
    question: "Will the Ethereum average base fee stay below 20 gwei for any 7-day period before April 10, 2026?",
    closingTime: days(21),
    category: "Crypto",
  },
  {
    question: "Will BTC price exceed $90,000 before May 1, 2026?",
    closingTime: days(42),
    category: "Crypto",
  },

  // ── DeFi ────────────────────────────────────────────────────────────────
  {
    question: "Will Uniswap V4 total TVL exceed $1 billion by June 1, 2026?",
    closingTime: days(73),
    category: "DeFi",
  },
  {
    question: "Will ETH liquid staking yield (Lido stETH APY) drop below 3% by May 15, 2026?",
    closingTime: days(56),
    category: "DeFi",
  },

  // ── Macro ────────────────────────────────────────────────────────────────
  {
    question: "Will the US Federal Reserve cut interest rates before June 15, 2026?",
    closingTime: days(87),
    category: "Macro",
  },
  {
    question: "Will XAU (gold) price exceed $3,200 per troy ounce by May 20, 2026?",
    closingTime: days(61),
    category: "Macro",
  },

  // ── Politics ─────────────────────────────────────────────────────────────
  {
    question: "Will the US SEC approve a spot ETH ETF with staking rewards enabled by June 30, 2026?",
    closingTime: days(102),
    category: "Politics",
  },

  // ── Science & Tech ───────────────────────────────────────────────────────
  {
    question: "Will any AI model publicly pass all sections of the US Medical Licensing Exam (USMLE) by May 31, 2026?",
    closingTime: days(72),
    category: "Science",
  },

  // ── Sports ───────────────────────────────────────────────────────────────
  {
    question: "Will a major centralised crypto exchange (Coinbase, Kraken, or Binance) complete a public stock offering before July 1, 2026?",
    closingTime: days(103),
    category: "Sports",
  },
];

const totalSeed = SEED * 2n * BigInt(MARKETS.length);
const balance   = await usdt.balanceOf(wallet.address);

console.log(`\nDeployer: ${wallet.address}`);
console.log(`USDT balance: $${(Number(balance) / 1e6).toFixed(2)}`);
console.log(`Total seed required: $${(Number(totalSeed) / 1e6).toFixed(2)} ($${(Number(SEED * 2n) / 1e6).toFixed(2)} per market × ${MARKETS.length} markets)\n`);

if (totalSeed > 0n && balance < totalSeed) {
  console.error(`Insufficient USDT. Need $${(Number(totalSeed) / 1e6).toFixed(2)}, have $${(Number(balance) / 1e6).toFixed(2)}.`);
  process.exit(1);
}

// Approve factory for total seed (skip if no seed needed)
if (totalSeed > 0n) {
  console.log("Approving USDT for factory...");
  const approveTx = await usdt.approve(FACTORY_ADDRESS, totalSeed);
  await approveTx.wait();
  console.log("✓ Approved\n");
}

const results = [];

for (let i = 0; i < MARKETS.length; i++) {
  const m = MARKETS[i];
  process.stdout.write(`[${i + 1}/${MARKETS.length}] ${m.category}: "${m.question.slice(0, 60)}..." `);

  try {
    const tx      = await factory.createMarket(m.question, m.closingTime, SEED, SEED);
    const receipt = await tx.wait();

    const marketAddress = receipt.logs
      .map((log) => { try { return iface.parseLog(log); } catch { return null; } })
      .find((e) => e?.name === "MarketCreated")
      ?.args?.[0] ?? "unknown";

    console.log(`✓ ${marketAddress}`);
    results.push({ ...m, address: marketAddress, ok: true });
  } catch (err) {
    console.log(`✗ FAILED: ${err.message}`);
    results.push({ ...m, address: null, ok: false, error: err.message });
  }
}

console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║               Batch Seed Complete                       ║");
console.log("╚══════════════════════════════════════════════════════════╝");

const ok  = results.filter((r) => r.ok);
const bad = results.filter((r) => !r.ok);

console.log(`\n✓ Created: ${ok.length}  ✗ Failed: ${bad.length}\n`);
for (const r of ok) {
  console.log(`  [${r.category}] ${r.address}`);
  console.log(`    "${r.question}"`);
  console.log(`    Closes: ${new Date(r.closingTime * 1000).toUTCString()}\n`);
}
if (bad.length > 0) {
  console.log("Failed markets:");
  for (const r of bad) console.log(`  ✗ ${r.question}\n    ${r.error}`);
}

console.log("The agent will discover all markets automatically on the next cycle.");
