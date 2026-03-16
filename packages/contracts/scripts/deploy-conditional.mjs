/**
 * deploy-conditional.mjs
 *
 * Deploys:
 *   1. ConditionalPayment — outcome-linked escrow contract
 *   2. A new PredictionMarket — with getMarketInfo() for IMarket compatibility
 *
 * Then wires them:
 *   - Registers new market with existing MarketResolver
 *   - Sets Chainlink feed on MarketResolver for auto-resolution
 *   - Prints env vars to add to packages/agent/.env
 *
 * Usage (from packages/contracts):
 *   node scripts/deploy-conditional.mjs
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dir   = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Load env ──────────────────────────────────────────────────────────────────
const envPath = resolve(__dir, "../.env");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const RPC_URL          = envVars["RPC_URL"];
const PRIVATE_KEY      = envVars["DEPLOYER_PRIVATE_KEY"];
const USDT_ADDRESS     = envVars["USDT_CONTRACT_ADDRESS"] ?? "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";
const RESOLVER_ADDRESS = envVars["MARKET_RESOLVER_ADDRESS"] ?? "";

// Chainlink ETH/USD on Sepolia
const CHAINLINK_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
const ETH_PRICE_TARGET  = BigInt(2500) * BigInt(1e8);  // $2,500 (8 dec)

if (!RPC_URL || !PRIVATE_KEY) {
  console.error("Missing RPC_URL or DEPLOYER_PRIVATE_KEY in .env");
  process.exit(1);
}
if (!RESOLVER_ADDRESS) {
  console.error("Missing MARKET_RESOLVER_ADDRESS in .env — run deploy-resolver.mjs first");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(PRIVATE_KEY.trim(), provider);
console.log("Deployer:", deployer.address);

// ── Load artifacts ────────────────────────────────────────────────────────────
const artifactsBase = resolve(__dir, "../artifacts/contracts");

function loadArtifact(name, folder) {
  return require(`${artifactsBase}/${folder ?? name}.sol/${name}.json`);
}

const ConditionalPaymentArtifact = loadArtifact("ConditionalPayment", "ConditionPayment");
const PredictionMarketArtifact   = loadArtifact("PredictionMarket");

const RESOLVER_ABI = [
  "function registerMarket(bytes32 marketId, address market) external",
  "function setChainlinkFeed(bytes32 marketId, address feed, int256 targetPrice) external",
];

// ── Step 1: Deploy ConditionalPayment ────────────────────────────────────────
console.log("\nDeploying ConditionalPayment…");

const cpFactory = new ethers.ContractFactory(
  ConditionalPaymentArtifact.abi,
  ConditionalPaymentArtifact.bytecode,
  deployer
);

const conditionalPayment = await cpFactory.deploy(deployer.address);
await conditionalPayment.waitForDeployment();
const cpAddress = await conditionalPayment.getAddress();
console.log("✓ ConditionalPayment deployed:", cpAddress);

// ── Step 2: Deploy new PredictionMarket (with getMarketInfo) ─────────────────
console.log("\nDeploying new PredictionMarket (IMarket-compatible)…");

const marketFactory = new ethers.ContractFactory(
  PredictionMarketArtifact.abi,
  PredictionMarketArtifact.bytecode,
  deployer
);

const QUESTION    = "Will ETH price be above $2,500 within 14 days?";
const closingTime = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;

const market = await marketFactory.deploy(
  QUESTION,
  USDT_ADDRESS,
  closingTime,
  0n,   // no seed — agent seeds on first enterPosition
  0n,
  50n,  // 0.5% fee
  deployer.address
);
await market.waitForDeployment();
const marketAddress = await market.getAddress();
console.log("✓ PredictionMarket deployed:", marketAddress);
console.log("  Question:", QUESTION);
console.log("  Closes:  ", new Date(closingTime * 1000).toISOString());

// ── Step 3: Set MarketResolver as the resolver on the new market ─────────────
console.log("\nWiring MarketResolver as resolver…");
const tx1 = await market.setResolver(RESOLVER_ADDRESS);
await tx1.wait();
console.log("✓ market.setResolver()");

// ── Step 4: Register new market with MarketResolver ──────────────────────────
const resolver = new ethers.Contract(RESOLVER_ADDRESS, RESOLVER_ABI, deployer);
const marketId = ethers.zeroPadValue(marketAddress, 32);

const tx2 = await resolver.registerMarket(marketId, marketAddress);
await tx2.wait();
console.log("✓ resolver.registerMarket() — marketId:", marketId);

const tx3 = await resolver.setChainlinkFeed(marketId, CHAINLINK_ETH_USD, ETH_PRICE_TARGET);
await tx3.wait();
console.log("✓ resolver.setChainlinkFeed() — target $2,500");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║         Conditional Payment Deployment Complete         ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log(`CONDITIONAL_PAYMENT_ADDRESS=${cpAddress}`);
console.log(`\nNew market (IMarket-compatible):`);
console.log(`MARKET_ADDRESS=${marketAddress}`);
console.log(`MARKET_ID=${marketId}`);
console.log(`\nAdd to packages/agent/.env:`);
console.log(`CONDITIONAL_PAYMENT_ADDRESS=${cpAddress}`);
console.log(`TREASURY_ADDRESS=${deployer.address}`);
console.log(`\nHow it works:`);
console.log(`  When the agent enters a market position, it locks a small`);
console.log(`  USDT performance fee in ConditionalPayment.`);
console.log(`  The fee is released to the treasury ONLY if the agent's`);
console.log(`  prediction is correct — paid at market resolution.`);
