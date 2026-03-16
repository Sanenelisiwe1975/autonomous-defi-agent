/**
 * create-market.mjs
 * Creates a prediction market via the deployed MarketFactory.
 *
 * Usage (from packages/contracts):
 *   node scripts/create-market.mjs
 *
 * Reads from .env in this directory.
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from contracts directory
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim()))
);

const RPC_URL          = envVars["RPC_URL"];
const PRIVATE_KEY      = envVars["DEPLOYER_PRIVATE_KEY"];
const FACTORY_ADDRESS  = envVars["MARKET_FACTORY_ADDRESS"];
const USDT_ADDRESS     = envVars["USDT_CONTRACT_ADDRESS"] ?? "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";

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

console.log("Creating market with:", wallet.address);

const usdt    = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, wallet);
const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);

// ── Market params ─────────────────────────────────────────────────────────────
const QUESTION    = "Will ETH price be above $2,500 within 7 days?";
const closingTime = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
// Pass 0,0 for initial reserves to avoid the double-transfer bug in the deployed contract.
// The agent's first enterPosition() call will seed the AMM reserves.
const SEED_YES    = 0n;
const SEED_NO     = 0n;

// ── Check balance ─────────────────────────────────────────────────────────────
const balance = await usdt.balanceOf(wallet.address);
console.log(`USDT balance: ${Number(balance) / 1e6} USDT`);

// ── Create market (no seed, no approval needed) ───────────────────────────────
console.log(`\nCreating market: "${QUESTION}"`);
const tx = await factory.createMarket(QUESTION, closingTime, SEED_YES, SEED_NO);
const receipt = await tx.wait();

// Parse MarketCreated event
const iface = new ethers.Interface(FACTORY_ABI);
const marketAddress = receipt.logs
  .map((log) => { try { return iface.parseLog(log); } catch { return null; } })
  .find((e) => e?.name === "MarketCreated")
  ?.args?.[0] ?? "unknown";

console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║               Market Created Successfully               ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log(`Market address: ${marketAddress}`);
console.log(`Question:       ${QUESTION}`);
console.log(`Closes at:      ${new Date(closingTime * 1000).toISOString()}`);
console.log(`\nThe agent will discover this market automatically on next cycle.`);
