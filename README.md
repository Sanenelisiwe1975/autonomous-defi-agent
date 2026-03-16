# Autonomous DeFi Agent

An autonomous on-chain agent that continuously observes DeFi markets, reasons about opportunities using Claude (Anthropic), decides risk-adjusted positions, executes trades via the Tether WDK, and learns from every cycle — all without human intervention.

Built for the **Tether Hackathon Galáctica: WDK Edition 1** — Track: **Autonomous DeFi Agent**.

---

## How It Works

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Agent Loop                                 │
│                                                                      │
│  Observe → Reason → Decide → Execute → Resolve → Learn               │
│    │          │        │        │          │         │               │
│  Prices    Claude    EV +     WDK +     AI Oracle  Postgres          │
│  Gas       Sonnet    Risk     Contracts  on-chain   Redis            │
│  Vault     Plan      Gates    + Cond.    rationale  JSON log         │
│  Markets           Payment  escrow                                   │
└──────────────────────────────────────────────────────────────────────┘
```

1. **Observe** — fetches ETH/USDT/XAUT prices (Chainlink + CoinGecko fallback), gas snapshot, Uniswap V3 liquidity, and active prediction market opportunities. Auto-tops-up agent USDT from `AgentVault` if balance drops below $50.
2. **Reason** — sends the full market state to Claude Sonnet via LangChain.js; receives a ranked list of `AgentAction` objects (OpenClaw-style planning engine).
3. **Decide** — applies global risk gates (USDT depeg halt, gas congestion halt) and per-action filters (min EV > 2%, max position size 5%, risk score ≤ 70).
4. **Execute** — routes approved actions via the Tether WDK (`transferUSDT`, `transferXAUT`) and direct Solidity calls (`enterPosition`, `redeem`). After each market entry, locks a 1% performance fee in `ConditionalPayment` — released to treasury only if the prediction is correct.
5. **Resolve** — after a market closes, the agent fetches the Chainlink price, compares it to the question threshold, calls `MarketResolver.aiResolve()` with a full rationale stored permanently on-chain, then finalises after the 24-hour dispute window.
6. **Learn** — persists cycle outcomes to a JSON log, PostgreSQL, and Redis; updates Bayesian priors per action type.

---

## Monorepo Structure

```
autonomous-defi-agent/
├── apps/
│   └── web/                  # Next.js 14 real-time dashboard
├── packages/
│   ├── agent/                # Autonomous loop (observe→learn)
│   ├── contracts/            # Solidity: AgentVault, PredictionMarket, MarketFactory
│   ├── data/                 # Oracle, Uniswap V3 liquidity, gas feeds
│   ├── planner/              # LLM reasoning engine (LangChain.js + Claude)
│   ├── wdk/                  # Tether WDK wallet wrapper
│   ├── ui/                   # Shared React components
│   ├── eslint-config/        # Shared ESLint presets
│   └── typescript-config/    # Shared tsconfig bases
├── infra/
│   ├── docker-compose.yml    # Postgres 16 + Redis 7
│   └── init.sql              # Database schema
└── .env.example              # All required environment variables
```

Each package has its own README with detailed API docs.

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis)
- An Ethereum RPC endpoint (Alchemy, Infura, or local node)
- Anthropic API key (optional — falls back to mock planner without it)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example packages/agent/.env
# Fill in RPC_URL, AGENT_SEED_PHRASE, ANTHROPIC_API_KEY, contract addresses
```

### 4. Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 5. Build all packages

```bash
npm run build
```

### 6. Deploy contracts (Sepolia)

```bash
cd packages/contracts
node scripts/deploy.mjs              # deploys AgentVault + MarketFactory
node scripts/set-vault-agent.mjs     # authorises WDK wallet on AgentVault
node scripts/deploy-resolver.mjs     # deploys MarketResolver + first PredictionMarket
node scripts/deploy-conditional.mjs  # deploys ConditionalPayment + IMarket-compatible market
```

Copy the printed addresses into `packages/agent/.env`:
- `AGENT_VAULT_ADDRESS`, `MARKET_FACTORY_ADDRESS`
- `MARKET_RESOLVER_ADDRESS`
- `CONDITIONAL_PAYMENT_ADDRESS`, `TREASURY_ADDRESS`

### 7. Run the agent

```bash
cd packages/agent
node --env-file=.env dist/index.js
```

### 8. Open the dashboard

```bash
# In a separate terminal, copy .env vars to apps/web/.env.local first
npm run dev --workspace=apps/web
# → http://localhost:3000/dashboard
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RPC_URL` | Yes | Ethereum JSON-RPC endpoint (Alchemy/Infura) |
| `AGENT_SEED_PHRASE` | Yes | BIP-39 mnemonic (12 or 24 words) — WDK wallet |
| `ANTHROPIC_API_KEY` | No | Claude API key (mock planner used if absent) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `USDT_CONTRACT_ADDRESS` | Yes | USD₮ ERC-20 contract address |
| `XAUT_CONTRACT_ADDRESS` | Yes | XAU₮ ERC-20 contract address |
| `AGENT_VAULT_ADDRESS` | Yes | Deployed AgentVault contract address |
| `MARKET_FACTORY_ADDRESS` | Yes | Deployed MarketFactory contract address |
| `MARKET_RESOLVER_ADDRESS` | Yes | Deployed MarketResolver contract address |
| `CONDITIONAL_PAYMENT_ADDRESS` | Yes | Deployed ConditionalPayment contract address |
| `TREASURY_ADDRESS` | Yes | Address that receives performance fees on correct predictions |
| `AGENT_DRY_RUN` | No | `true` = log only, no real txs (default: `true`) |
| `AGENT_LOOP_INTERVAL_MS` | No | Loop interval in ms (default: `60000`) |
| `LLM_MODEL` | No | Claude model override (default: `claude-sonnet-4-6`) |
| `WALLET_MAX_FEE_WEI` | No | Max gas per transfer in wei (default: `1000000000000000`) |

See `.env.example` for the full list with default values.

---

## Smart Contracts (Sepolia Testnet)

| Contract | Address | Purpose |
|---|---|---|
| `AgentVault` | `0x824a901E3609C5d8D6F874b31Fe736364190119D` | Holds USD₮; enforces $1,000/day agent withdrawal limit |
| `MarketFactory` | `0x3947C99650879990cB2c0C0cbB22FE71e5CF11f9` | Creates and registers PredictionMarket instances |
| `PredictionMarket` | `0xbfDa4f28C0df0ad6d3c7366667934F9c866483Bd` | Binary AMM — YES/NO outcome token market (IMarket-compatible) |
| `OutcomeToken` | (deployed by market) | ERC-20 representing a single market outcome |
| `MarketResolver` | `0x8e50025719b9f605C11Eb43c1683C9536eAdc8B0` | Multi-path resolution: AI oracle, Chainlink, UMA, multisig |
| `ConditionalPayment` | `0xca2b23094987a1Cc0100A291eD701085464B4aE9` | Outcome-linked USDT escrow — performance fee released only if prediction is correct |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Wallet | Tether WDK (`@tetherto/wdk-wallet-evm`) |
| AI Planning | LangChain.js + Claude Sonnet 4.6 (`@langchain/anthropic`) |
| Price Feeds | Chainlink AggregatorV3 + CoinGecko REST API (fallback) |
| DEX Data | Uniswap V3 pool queries via ethers.js |
| Smart Contracts | Solidity 0.8 + Hardhat |
| Dashboard | Next.js 14 App Router + Recharts |
| Database | PostgreSQL 16 |
| Cache / PubSub | Redis 7 |
| Monorepo | Turborepo + npm workspaces |
| Language | TypeScript ESM throughout |

---

## Third-Party Services & APIs

| Service | Purpose | Terms |
|---|---|---|
| [Anthropic Claude](https://anthropic.com) | LLM reasoning (claude-sonnet-4-6) | Commercial API |
| [Alchemy](https://alchemy.com) | Ethereum RPC endpoint | Commercial API |
| [Chainlink](https://chain.link) | On-chain price feeds (ETH/USD, XAU/USD, USDT/USD) | Open smart contracts |
| [CoinGecko](https://coingecko.com) | Price fallback REST API | Free public API |
| [Uniswap V3](https://uniswap.org) | Liquidity pool data | Open smart contracts |
| [LangChain.js](https://js.langchain.com) | LLM framework | MIT license |
| [OpenZeppelin](https://openzeppelin.com) | Solidity contract base classes | MIT license |
| [ethers.js v6](https://ethers.org) | Ethereum library | MIT license |

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed walkthrough of every module and how a single agent cycle flows end-to-end.

---

## Risk Controls

- **USDT depeg halt** — all execution suspended if USDT price deviates >0.5% from $1.00
- **Gas congestion halt** — all execution suspended if base fee >100 gwei
- **EV threshold** — ENTER_MARKET rejected if net expected value <2% (after gas costs)
- **Risk score filter** — rejects positions with probability uncertainty + payout ratio risk >70/100
- **Position cap** — individual positions clamped to 5% of total portfolio
- **Daily vault limit** — `AgentVault` contract enforces $1,000/day withdrawal ceiling on-chain
- **Slippage guard** — market entry accepts minimum 95% of quoted token output
- **Dry-run mode** — `AGENT_DRY_RUN=true` by default; no real transactions until explicitly enabled

---

## Development Commands

```bash
npm run build          # Build all packages (respects dependency order)
npm run dev            # Start all packages in watch mode
npm run lint           # Lint all packages
npm run check-types    # Type-check all packages
npm run clean          # Remove all dist/ directories
```

Run a single package with `--filter`:

```bash
npm run build -- --filter=@repo/agent
npm run dev   -- --filter=@repo/planner
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
