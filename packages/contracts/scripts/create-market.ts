/**
 * @file scripts/create-market.ts
 * @description Creates a prediction market via the deployed MarketFactory.
 *
 * Usage:
 *   npx hardhat run scripts/create-market.ts --network sepolia
 *
 * The script:
 *   1. Approves USDT seed liquidity for the factory
 *   2. Calls MarketFactory.createMarket() with a question and closing time
 *   3. Logs the deployed PredictionMarket address
 */

import { ethers } from "hardhat";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Creating market with:", deployer.address);

  const USDT_ADDRESS =
    process.env["USDT_CONTRACT_ADDRESS"] ??
    "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06";

  const FACTORY_ADDRESS = process.env["MARKET_FACTORY_ADDRESS"];
  if (!FACTORY_ADDRESS) {
    throw new Error("MARKET_FACTORY_ADDRESS not set in .env");
  }

  // ── Market parameters ────────────────────────────────────────────────────

  const QUESTION = "Will ETH price be above $2,500 within 7 days?";

  // Closing time: 7 days from now
  const closingTime = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  // Seed liquidity: $50 YES + $50 NO = $100 total (balanced = 50/50 probability)
  const SEED_YES = ethers.parseUnits("50", 6);  // 50 USDT
  const SEED_NO  = ethers.parseUnits("50", 6);  // 50 USDT
  const SEED_TOTAL = SEED_YES + SEED_NO;

  // ── Check balance ─────────────────────────────────────────────────────────

  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, deployer);
  const balance: bigint = await usdt.balanceOf(deployer.address);
  console.log(`USDT balance: ${ethers.formatUnits(balance, 6)} USDT`);

  if (balance < SEED_TOTAL) {
    throw new Error(
      `Insufficient USDT. Need ${ethers.formatUnits(SEED_TOTAL, 6)} USDT, have ${ethers.formatUnits(balance, 6)}`
    );
  }

  // ── Approve factory to spend seed liquidity ───────────────────────────────

  console.log(`\nApproving ${ethers.formatUnits(SEED_TOTAL, 6)} USDT for factory…`);
  const approveTx = await usdt.approve(FACTORY_ADDRESS, SEED_TOTAL);
  await approveTx.wait();
  console.log("✓ Approved");

  // ── Create the market ─────────────────────────────────────────────────────

  const factory = await ethers.getContractAt("MarketFactory", FACTORY_ADDRESS);

  console.log(`\nCreating market: "${QUESTION}"`);
  console.log(`Closing time: ${new Date(closingTime * 1000).toISOString()}`);
  console.log(`Seed: $${ethers.formatUnits(SEED_YES, 6)} YES / $${ethers.formatUnits(SEED_NO, 6)} NO`);

  const tx = await factory.createMarket(
    QUESTION,
    closingTime,
    SEED_YES,
    SEED_NO
  );
  const receipt = await tx.wait();

  // Parse the MarketCreated event to get the deployed address
  const event = receipt?.logs
    .map((log: { topics: string[]; data: string }) => {
      try { return factory.interface.parseLog(log); } catch { return null; }
    })
    .find((e: { name: string } | null) => e?.name === "MarketCreated");

  const marketAddress: string = event?.args?.[0] ?? "unknown";

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║               Market Created Successfully               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Market address: ${marketAddress}`);
  console.log(`Question:       ${QUESTION}`);
  console.log(`Closes at:      ${new Date(closingTime * 1000).toISOString()}`);
  console.log(`\nThe agent will discover this market automatically on next cycle.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
