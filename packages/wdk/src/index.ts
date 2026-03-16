/**
 * @file index.ts
 * @description Public API surface of @repo/wdk.
 *
 * All wallet management, transaction execution, and account abstraction
 * utilities are re-exported from here so consuming packages only need
 * a single import path.
 *
 * @example
 * ```ts
 * import { createAgentWallet, transferUSDT, getPortfolioSnapshot } from "@repo/wdk";
 * ```
 *
 * @license Apache-2.0
 */

// Wallet creation & lifecycle
export {
  AgentWallet,
  createAgentWallet,
  type WalletConfig,
  type AccountInfo,
} from "./wallet.js";

// Token transfers
export {
  transferToken,
  transferUSDT,
  transferXAUT,
  quoteTransfer,
  getTokenAddress,
  type TokenSymbol,
  type TransferParams,
  type TransferResult,
  type TransferQuote,
} from "./transactions.js";

// Account abstraction & portfolio snapshots
export {
  getEthBalance,
  getUsdtBalance,
  getXautBalance,
  getPortfolioSnapshot,
  formatEth,
  formatUsdt,
  formatXaut,
  formatPortfolio,
  hasEnoughGas,
  MIN_ETH_FOR_GAS,
  type PortfolioSnapshot,
  type PortfolioDisplay,
} from "./accounts.js";
