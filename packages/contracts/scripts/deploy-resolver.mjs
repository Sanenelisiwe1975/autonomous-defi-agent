/**
 * deploy-resolver.mjs
 *
 * Deploys:
 *   1. MarketResolver  — with the agent (WDK) wallet as aiOracle
 *   2. A new PredictionMarket — "Will ETH price be above $2,500 in 14 days?"
 *
 * Then wires them together:
 *   - market.setResolver(marketResolverAddress)
 *   - resolver.registerMarket(marketId, marketAddress)
 *   - resolver.setChainlinkFeed(marketId, ETH_USD_FEED, 2500e8)
 *
 * Usage (from packages/contracts):
 *   node scripts/deploy-resolver.mjs
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dir   = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const envPath = resolve(__dir, "../.env");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const RPC_URL         = envVars["RPC_URL"];
const PRIVATE_KEY     = envVars["DEPLOYER_PRIVATE_KEY"];
const USDT_ADDRESS    = envVars["USDT_CONTRACT_ADDRESS"] ?? "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";
const XAUT_ADDRESS    = envVars["XAUT_CONTRACT_ADDRESS"] ?? "0x68749665FF8D2d112Fa859AA293F07A622782F38";

// WDK wallet — will be authorised as aiOracle on MarketResolver
const WDK_WALLET = "0xd4f54bB98BA78a813c82C78934191cBba3C33900";

const CHAINLINK_ETH_USD_SEPOLIA = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

const ETH_PRICE_TARGET = BigInt(2500) * BigInt(1e8);

if (!RPC_URL || !PRIVATE_KEY) {
  console.error("Missing RPC_URL or DEPLOYER_PRIVATE_KEY in .env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(PRIVATE_KEY.trim(), provider);

console.log("Deployer:", deployer.address);
console.log("AI Oracle (WDK wallet):", WDK_WALLET);
console.log();

const artifactsBase = resolve(__dir, "../artifacts/contracts");

function loadArtifact(name) {
  try {
    return require(`${artifactsBase}/${name}.sol/${name}.json`);
  } catch {
  
    try {
      return require(`${artifactsBase}/${name}.json`);
    } catch {
      throw new Error(`Cannot find compiled artifact for ${name}. Run: npx hardhat compile`);
    }
  }
}

console.log("Loading compiled artifacts…");
let MarketResolverArtifact, PredictionMarketArtifact;
try {
  MarketResolverArtifact  = loadArtifact("MarketResolver");
  PredictionMarketArtifact = loadArtifact("PredictionMarket");
} catch (err) {
  console.error(err.message);
  console.error("Run: cd packages/contracts && npx hardhat compile");
  process.exit(1);
}

console.log("Deploying MarketResolver…");

const resolverFactory = new ethers.ContractFactory(
  MarketResolverArtifact.abi,
  MarketResolverArtifact.bytecode,
  deployer
);

const committee = [
  deployer.address,
  deployer.address,
  deployer.address,
  deployer.address,
  deployer.address,
];

const marketResolver = await resolverFactory.deploy(
  deployer.address, 
  USDT_ADDRESS,      
  committee,         
  WDK_WALLET         
);
await marketResolver.waitForDeployment();
const resolverAddress = await marketResolver.getAddress();
console.log("✓ MarketResolver deployed:", resolverAddress);

console.log("\nDeploying new PredictionMarket…");

const marketFactory = new ethers.ContractFactory(
  PredictionMarketArtifact.abi,
  PredictionMarketArtifact.bytecode,
  deployer
);

const QUESTION    = "Will ETH price be above $2,500 within 14 days?";
const closingTime = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
const FEE_BPS     = 50n; // 0.5%

const market = await marketFactory.deploy(
  QUESTION,
  USDT_ADDRESS,
  closingTime,
  0n,            // initialYesUsdt — seeded by agent on first trade
  0n,            // initialNoUsdt
  FEE_BPS,
  deployer.address
);
await market.waitForDeployment();
const marketAddress = await market.getAddress();
console.log("✓ PredictionMarket deployed:", marketAddress);
console.log("  Question:", QUESTION);
console.log("  Closes:  ", new Date(closingTime * 1000).toISOString());

console.log("\nWiring contracts…");

const tx1 = await market.setResolver(resolverAddress);
await tx1.wait();
console.log("✓ market.setResolver() →", resolverAddress);

const marketId = ethers.zeroPadValue(marketAddress, 32);
console.log("  marketId:", marketId);

const tx2 = await marketResolver.registerMarket(marketId, marketAddress);
await tx2.wait();
console.log("✓ resolver.registerMarket()");

const tx3 = await marketResolver.setChainlinkFeed(
  marketId,
  CHAINLINK_ETH_USD_SEPOLIA,
  ETH_PRICE_TARGET
);
await tx3.wait();
console.log(`✓ resolver.setChainlinkFeed() — target $2,500 (${ETH_PRICE_TARGET})`);

console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║           Resolver Deployment Complete                  ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log(`MARKET_RESOLVER_ADDRESS=${resolverAddress}`);
console.log(`MARKET_FACTORY_MARKET_ADDRESS=${marketAddress}`);
console.log(`MARKET_ID=${marketId}`);
console.log(`\nAdd to packages/agent/.env:`);
console.log(`MARKET_RESOLVER_ADDRESS=${resolverAddress}`);
console.log(`\nThe agent will:`);
console.log(`  1. Detect market expiry (${new Date(closingTime * 1000).toLocaleDateString()})`);
console.log(`  2. Fetch ETH price from Chainlink`);
console.log(`  3. Call aiResolve() with on-chain reasoning`);
console.log(`  4. Call finalizeResolution() after 24h dispute window`);
