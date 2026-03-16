/**
 * @file scripts/deploy.ts
 * @description Hardhat deployment script for all contracts.
 *
 * Deploy order:
 *   1. AgentVault (holds USDT + XAUT reserves, enforces daily limits)
 *   2. MarketFactory (creates and registers PredictionMarkets)
 *
 * PredictionMarkets are created via the factory after deployment.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // ── Token addresses (from .env or hardcoded for Sepolia) ──────────────────
  const USDT_ADDRESS =
    process.env["USDT_CONTRACT_ADDRESS"] ??
    "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06"; // Sepolia USDT
  const XAUT_ADDRESS =
    process.env["XAUT_CONTRACT_ADDRESS"] ??
    "0x68749665FF8D2d112Fa859AA293F07A622782F38";

  const AGENT_ADDRESS =
    process.env["AGENT_ADDRESS"] ?? deployer.address; // Replace with real agent WDK address

  // ── Deploy AgentVault ──────────────────────────────────────────────────────
  console.log("\n[1/2] Deploying AgentVault…");
  const AgentVault = await ethers.getContractFactory("AgentVault");
  const DAILY_LIMIT = ethers.parseUnits("1000", 6); // $1,000 USDT per day

  const vault = await AgentVault.deploy(
    USDT_ADDRESS,
    XAUT_ADDRESS,
    AGENT_ADDRESS,
    DAILY_LIMIT,
    deployer.address
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("AgentVault deployed to:", vaultAddress);

  // ── Deploy MarketFactory ───────────────────────────────────────────────────
  console.log("\n[2/2] Deploying MarketFactory…");
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const DEFAULT_FEE_BPS = 50; // 0.5%

  const factory = await MarketFactory.deploy(
    USDT_ADDRESS,
    DEFAULT_FEE_BPS,
    false, // not permissionless — only owner can create markets initially
    deployer.address
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("MarketFactory deployed to:", factoryAddress);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                  Deployment Summary                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`AGENT_VAULT_ADDRESS=${vaultAddress}`);
  console.log(`MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log("\nAdd these values to your .env file to wire up the agent.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
