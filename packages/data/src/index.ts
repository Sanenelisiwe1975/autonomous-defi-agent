/**
 * @file index.ts
 * @description Public API surface of @repo/data.
 * @license Apache-2.0
 */

export {
  fetchPrices,
  isUsdtDepegged,
  type PriceData,
  type OraclePrices,
} from "./oracle.js";

export {
  fetchUsdtEthLiquidity,
  fetchPredictionMarketLiquidity,
  hasSufficientLiquidity,
  type LiquiditySnapshot,
  type PoolInfo,
} from "./liquidity.js";

export {
  fetchGasSnapshot,
  estimateOperationCostUsd,
  isNetworkCongested,
  breakEvenProfitUsd,
  GAS_UNITS,
  type GasSnapshot,
  type OperationType,
} from "./gas.js";
