/**
 * @file execute.ts
 * @description EXECUTE phase — WDK on-chain transaction routing.
 *
 * Routes each approved action to the appropriate WDK call:
 *
 *   ENTER_MARKET → transferUSDT to prediction market contract
 *   EXIT_MARKET  → call market redeem (via sendTransaction)
 *   REBALANCE    → transferUSDT / transferXAUT
 *   HOLD         → no-op
 *
 * All transactions are signed noncustodially by the WDK wallet.
 * The function returns detailed results for each action.
 *
 * @license Apache-2.0
 */

import {
  transferUSDT,
  transferXAUT,
  type TransferResult,
} from "@repo/wdk";
import type { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import type {
  AgentAction,
  EnterMarketAction,
  ExitMarketAction,
  RebalanceAction,
} from "@repo/planner";
import type { DecisionResult } from "./decide.js";
import { ethers } from "ethers";
import {
  getEthersSigner,
  PREDICTION_MARKET_ABI,
  ERC20_ABI,
  CONDITIONAL_PAYMENT_ABI,
  OutcomeIndex,
  PayoffType,
} from "./contracts.js";

export interface ExecutionResult {
  actionId: string;
  actionType: AgentAction["type"];
  success: boolean;
  txHash?: string;
  feeWei?: bigint;
  error?: string;
  skipped: boolean;
  skipReason?: string;
  executedAt: string;
}

/**
 * Creates a ConditionalPayment locking a performance fee in escrow.
 * The fee is released to the treasury ONLY if the agent's predicted outcome is correct.
 * Silently no-ops if CONDITIONAL_PAYMENT_ADDRESS or TREASURY_ADDRESS are not configured.
 */
async function createConditionalPayment(
  signer: ReturnType<typeof getEthersSigner>,
  marketAddress: string,
  isYes: boolean,
  amountMicroUsdt: bigint
): Promise<string | null> {
  const cpAddress   = process.env["CONDITIONAL_PAYMENT_ADDRESS"];
  const treasury    = process.env["TREASURY_ADDRESS"];
  const usdtAddress = process.env["USDT_CONTRACT_ADDRESS"];
  if (!cpAddress || !treasury || !usdtAddress) return null;

  // Performance fee: 1% of position, minimum 1 USDT (1_000_000 micro)
  const feeAmount = amountMicroUsdt / 100n < 1_000_000n ? 1_000_000n : amountMicroUsdt / 100n;

  // marketId is the address zero-padded to 32 bytes
  const marketId = ethers.zeroPadValue(marketAddress, 32);
  const trigger  = isYes ? OutcomeIndex.YES : OutcomeIndex.NO;

  // Expiry: 60 days from now (well past any market close + dispute window)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usdt = new ethers.Contract(usdtAddress, ERC20_ABI, signer) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cp   = new ethers.Contract(cpAddress, CONDITIONAL_PAYMENT_ABI, signer) as any;

  // Approve fee amount to ConditionalPayment contract
  const approveTx = await usdt.approve(cpAddress, feeAmount);
  await approveTx.wait();

  const tx = await cp.createPayment(
    treasury,
    marketAddress,
    marketId,
    usdtAddress,
    feeAmount,
    trigger,
    PayoffType.BINARY,
    "0x",        // no custom payoff curve
    expiresAt
  );
  const receipt = await tx.wait();
  return receipt.hash as string;
}

function getMarketContractAddress(marketId: string): string | null {
  // If marketId is already an Ethereum address (from onchain discovery), use it directly
  if (ethers.isAddress(marketId)) return marketId;
  // Otherwise fall back to env var lookup
  const id = marketId as string;
  const envKey = `MARKET_${id.toUpperCase().replace(/-/g, "_")}_ADDRESS`;
  return process.env[envKey] ?? null;
}


async function executeEnterMarket(
  _account: WalletAccountEvm,
  action: EnterMarketAction,
  dryRun: boolean,
  rpcUrl: string
): Promise<ExecutionResult> {
  const base: Omit<ExecutionResult, "success" | "txHash" | "feeWei" | "error" | "skipped"> = {
    actionId: action.id,
    actionType: "ENTER_MARKET",
    executedAt: new Date().toISOString(),
  };

  const contractAddress = getMarketContractAddress(action.marketId);
  const amountUsd = Number(action.amountMicroUsdt) / 1e6;

  console.log(
    `  → ENTER_MARKET ${action.marketId} | $${amountUsd.toFixed(2)} USDT | ` +
    `outcome=${action.outcome} | p=${action.probability}`
  );

  if (dryRun || !contractAddress) {
    const skipReason = dryRun ? "DRY_RUN" : `Market contract not found for ${action.marketId}`;
    console.log(`    [${dryRun ? "DRY RUN" : "SKIP"}] ${skipReason}`);
    return { ...base, success: true, skipped: true, skipReason };
  }

  try {
    const signer = getEthersSigner(rpcUrl);
    const usdtAddress = process.env["USDT_CONTRACT_ADDRESS"]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usdt = new ethers.Contract(usdtAddress, ERC20_ABI, signer) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const market = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, signer) as any;

    const isYes = action.outcome === "YES";

    // Quote expected tokens out (for slippage guard — accept 95% of quote)
    const expectedTokens: bigint = await market.quoteEnterPosition(isYes, action.amountMicroUsdt);
    const minTokensOut = (expectedTokens * 95n) / 100n;

    // Approve USDT spend
    const approveTx = await usdt.approve(contractAddress, action.amountMicroUsdt);
    await approveTx.wait();
    console.log(`    ✓ USDT approved`);

    // Enter position
    const tx = await market.enterPosition(isYes, action.amountMicroUsdt, minTokensOut);
    const receipt = await tx.wait();
    const feeWei = BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? 0);

    console.log(`    ✓ TX: ${receipt.hash} | fee: ${feeWei} wei`);

    // Lock a performance fee in ConditionalPayment — released only if prediction is correct
    try {
      const cpHash = await createConditionalPayment(signer, contractAddress, isYes, action.amountMicroUsdt);
      if (cpHash) console.log(`    ✓ ConditionalPayment created: ${cpHash}`);
    } catch (cpErr) {
      console.warn(`    ⚠ ConditionalPayment skipped: ${cpErr instanceof Error ? cpErr.message : cpErr}`);
    }

    return { ...base, success: true, txHash: receipt.hash, feeWei, skipped: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`    ✗ Failed: ${error}`);
    return { ...base, success: false, error, skipped: false };
  }
}

async function executeExitMarket(
  _account: WalletAccountEvm,
  action: ExitMarketAction,
  dryRun: boolean,
  rpcUrl: string
): Promise<ExecutionResult> {
  const base: Omit<ExecutionResult, "success" | "txHash" | "feeWei" | "error" | "skipped"> = {
    actionId: action.id,
    actionType: "EXIT_MARKET",
    executedAt: new Date().toISOString(),
  };

  console.log(`  → EXIT_MARKET ${action.marketId}`);

  if (dryRun) {
    return { ...base, success: true, skipped: true, skipReason: "DRY_RUN" };
  }

  try {
    const signer = getEthersSigner(rpcUrl);
    // positionTokenAddress is the OutcomeToken contract; redeem() is on the market contract
    const marketAddress = getMarketContractAddress(action.marketId);
    if (!marketAddress) {
      return { ...base, success: true, skipped: true, skipReason: `Market contract not found for ${action.marketId}` };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positionToken = new ethers.Contract(action.positionTokenAddress, ERC20_ABI, signer) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const market = new ethers.Contract(marketAddress, PREDICTION_MARKET_ABI, signer) as any;

    // Approve the market to burn our outcome tokens
    const approveTx = await positionToken.approve(marketAddress, action.amountTokens);
    await approveTx.wait();

    const tx = await market.redeem(action.amountTokens);
    const receipt = await tx.wait();
    const feeWei = BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? 0);

    console.log(`    ✓ TX: ${receipt.hash} | fee: ${feeWei} wei`);
    return { ...base, success: true, txHash: receipt.hash, feeWei, skipped: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`    ✗ Failed: ${error}`);
    return { ...base, success: false, error, skipped: false };
  }
}

async function executeRebalance(
  account: WalletAccountEvm,
  action: RebalanceAction,
  dryRun: boolean
): Promise<ExecutionResult> {
  const base: Omit<ExecutionResult, "success" | "txHash" | "feeWei" | "error" | "skipped"> = {
    actionId: action.id,
    actionType: "REBALANCE",
    executedAt: new Date().toISOString(),
  };

  console.log(
    `  → REBALANCE goal=${action.goalId} | ` +
    `from=${action.fromToken} | $${Number(action.amountMicroUsdt) / 1e6}`
  );

  if (dryRun) {
    return { ...base, success: true, skipped: true, skipReason: "DRY_RUN" };
  }

  try {
    const vaultAddress = process.env["AGENT_VAULT_ADDRESS"];
    if (!vaultAddress) {
      return {
        ...base,
        success: true,
        skipped: true,
        skipReason: "AGENT_VAULT_ADDRESS not configured",
      };
    }

    let result: TransferResult;
    if (action.fromToken === "XAUT") {
      result = await transferXAUT(account, vaultAddress, action.amountMicroUsdt);
    } else {
      result = await transferUSDT(account, vaultAddress, action.amountMicroUsdt);
    }

    console.log(`    ✓ TX: ${result.hash}`);
    return { ...base, success: true, txHash: result.hash, feeWei: result.fee, skipped: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ...base, success: false, error, skipped: false };
  }
}


/**
 * Executes all approved actions from the Decide phase using the WDK wallet.
 *
 * @param decision - DecisionResult from the Decide phase
 * @param account  - WDK wallet account (signs all transactions)
 * @param dryRun   - If true, logs all actions but submits no transactions
 */
export async function execute(
  decision: DecisionResult,
  account: WalletAccountEvm,
  dryRun: boolean,
  rpcUrl: string
): Promise<ExecutionResult[]> {
  const actionsToExecute = decision.approved.filter((a) => a.type !== "HOLD");

  console.log(
    `[EXECUTE] ${actionsToExecute.length} action(s) to execute` +
    (dryRun ? " [DRY RUN]" : "")
  );

  if (decision.skippedAll) {
    console.log(`[EXECUTE] All skipped: ${decision.skippedAllReason ?? "unknown"}`);
    return [];
  }

  const results: ExecutionResult[] = [];

  for (const action of actionsToExecute) {
    let result: ExecutionResult;

    switch (action.type) {
      case "ENTER_MARKET":
        result = await executeEnterMarket(account, action as EnterMarketAction, dryRun, rpcUrl);
        break;
      case "EXIT_MARKET":
        result = await executeExitMarket(account, action as ExitMarketAction, dryRun, rpcUrl);
        break;
      case "REBALANCE":
        result = await executeRebalance(account, action as RebalanceAction, dryRun);
        break;
      default: {
        // HOLD is filtered above; this branch is unreachable at runtime
        const _exhaustive: never = action;
        void _exhaustive;
        result = {
          actionId: "unknown",
          actionType: "HOLD",
          success: true,
          skipped: true,
          skipReason: "Unreachable branch",
          executedAt: new Date().toISOString(),
        };
      }
    }

    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`[EXECUTE] Done: ${succeeded} ok, ${failed} failed, ${results.filter(r => r.skipped).length} skipped`);

  return results;
}
