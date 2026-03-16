# @repo/contracts — Solidity Smart Contracts

Hardhat project containing the on-chain prediction market infrastructure and agent vault.

## Contracts

| Contract | Purpose |
|---|---|
| `AgentVault.sol` | Holds USD₮ deposits; allows agent to withdraw for trade execution |
| `PredictionMarket.sol` | Binary AMM — users buy YES/NO outcome tokens against a USDT pool |
| `OutcomeToken.sol` | ERC-20 representing a market outcome (YES or NO share) |
| `MarketFactory.sol` | Deploys and registers new `PredictionMarket` instances |

## Architecture

```
User ──USDT──▶ AgentVault
                   │ agentWithdrawUsdt()
                   ▼
              PredictionMarket ◀── MarketFactory.createMarket()
              ┌──────────────┐
              │  YES tokens  │  OutcomeToken (ERC-20)
              │  NO  tokens  │  OutcomeToken (ERC-20)
              └──────────────┘
```

## Build & Deploy

```bash
# Compile + generate TypeChain typings
npx hardhat compile

# Deploy to Sepolia
npx hardhat run scripts/deploy.ts --network sepolia

# Run contract tests
npx hardhat test
```

After deploying, set `MARKET_FACTORY_ADDRESS` in your `.env` file.

## Artifacts

Compiled artifacts are written to `artifacts/` and TypeChain typings to `typechain-types/`. Both directories are included in the Turborepo build cache.

## Environment Variables

| Variable | Description |
|---|---|
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC endpoint for deployment |
| `DEPLOYER_PRIVATE_KEY` | Private key of the deployer wallet |
| `ETHERSCAN_API_KEY` | For contract verification (optional) |
