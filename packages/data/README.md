# @repo/data — Market Data Layer

Fetches on-chain and off-chain market data: price feeds, Uniswap V3 liquidity, and EIP-1559 gas snapshots.

## Modules

| File | Purpose |
|---|---|
| `oracle.ts` | Chainlink AggregatorV3 price feeds with CoinGecko REST fallback |
| `liquidity.ts` | Uniswap V3 pool slot0 / liquidity queries |
| `gas.ts` | EIP-1559 gas estimation and congestion detection |

## Usage

```ts
import { fetchPrices, isUsdtDepegged } from "@repo/data";
import { fetchGasSnapshot, isNetworkCongested } from "@repo/data";
import { fetchPoolLiquidity } from "@repo/data";

const prices = await fetchPrices(provider);
// { ethUsd: 2400.5, usdtUsd: 1.0001, xautUsd: 2050.3 }

const gas = await fetchGasSnapshot(provider);
// { baseFeePerGas: 12n, maxPriorityFee: 1500000000n, gasPriceGwei: 13.5 }

const liquidity = await fetchPoolLiquidity(provider, poolAddress);
// { sqrtPriceX96: …, liquidity: …, tick: … }
```

## Price Feed Architecture

```
Chainlink AggregatorV3 (primary)
        │  fails / stale
        ▼
CoinGecko REST API (fallback)
```

Prices are considered stale if the Chainlink round is older than **1 hour**.

## Sepolia Behaviour

On Sepolia testnet (`ETH_RPC_URL` points to Sepolia) liquidity queries return **mock data** since Uniswap V3 pools are not fully deployed on testnet.

## Environment Variables

| Variable | Description |
|---|---|
| `ETH_RPC_URL` | Ethereum JSON-RPC endpoint |
| `CHAINLINK_ETH_USD` | Chainlink ETH/USD feed address |
| `CHAINLINK_XAUT_USD` | Chainlink XAU/USD feed address |
| `UNISWAP_USDT_ETH_POOL` | Uniswap V3 USDT/ETH pool address |
