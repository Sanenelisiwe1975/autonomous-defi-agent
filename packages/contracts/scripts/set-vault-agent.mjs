/**
 * set-vault-agent.mjs
 * Updates the AgentVault's authorised agent address to the WDK wallet.
 *
 * Usage: node scripts/set-vault-agent.mjs
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
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const RPC_URL       = envVars["RPC_URL"];
const PRIVATE_KEY   = envVars["DEPLOYER_PRIVATE_KEY"];
const VAULT_ADDRESS = envVars["AGENT_VAULT_ADDRESS"];
// WDK wallet — agent that will be authorised to withdraw
const WDK_WALLET    = "0xd4f54bB98BA78a813c82C78934191cBba3C33900";

const VAULT_ABI = [
  "function agent() external view returns (address)",
  "function setAgent(address newAgent) external",
  "function usdtBalance() external view returns (uint256)",
  "function remainingDailyUsdt() external view returns (uint256)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(PRIVATE_KEY, provider);
const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, deployer);

const currentAgent = await vault.agent();
console.log("Current vault agent:", currentAgent);
console.log("Setting agent to:   ", WDK_WALLET);

if (currentAgent.toLowerCase() === WDK_WALLET.toLowerCase()) {
  console.log("Already set correctly. Nothing to do.");
  process.exit(0);
}

const tx = await vault.setAgent(WDK_WALLET);
await tx.wait();
console.log("✓ Agent updated. TX:", tx.hash);

const usdtBal = await vault.usdtBalance();
const remaining = await vault.remainingDailyUsdt();
console.log(`\nVault USDT balance:     $${Number(usdtBal) / 1e6}`);
console.log(`Daily limit remaining:  $${Number(remaining) / 1e6}`);
