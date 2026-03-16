# How This Project Is Connected — A Beginner's Guide

This document explains the whole system from scratch: what each piece does, why it exists, and how the pieces talk to each other. Read this before diving into any individual package.

---

## The Big Picture — What Is This Thing?

This is a **bot that manages money on a blockchain by itself.**

Every 60 seconds it wakes up, looks at the market, thinks about what to do, makes a decision, does a trade (or not), and records what happened. Then it sleeps and does it all again — forever, without a human pressing any buttons.

The loop has five steps and each step is its own file:

```
observe.ts  →  reason.ts  →  decide.ts  →  execute.ts  →  learn.ts
   │               │              │              │              │
 "What is        "What         "Should        "Actually       "Write
  happening       should        I do          do it"          it down"
  right now?"     I do?"        this?"
```

---

## The Monorepo — Why So Many Folders?

The project is split into **packages** (libraries) and **apps** (things that run). This is called a monorepo — one Git repo, many projects that share code.

```
autonomous-defi-agent/
│
├── packages/          ← libraries (no user-facing UI)
│   ├── wdk/           ← talks to the blockchain wallet
│   ├── data/          ← fetches prices, gas costs, market data
│   ├── planner/       ← asks Claude (Anthropic) what to do
│   └── agent/         ← the main loop (uses all three above)
│
├── apps/
│   └── web/           ← dashboard website so you can watch the bot
│
├── packages/contracts/ ← the Solidity smart contracts on-chain
└── infra/              ← Docker files to run a database and cache
```

**Why split it up?** Each package has one job. You can swap out `data/` (e.g. use a different price source) without touching `agent/`. You can test `planner/` in isolation without a real wallet.

---

## Package Dependency Map

This shows which package imports which. An arrow means "uses":

```
                 ┌──────────────┐
                 │  @repo/data  │  prices, gas, liquidity
                 └──────┬───────┘
                        │
          ┌─────────────┼──────────────┐
          │             │              │
          ▼             ▼              ▼
   ┌────────────┐ ┌──────────────┐    │
   │  @repo/wdk │ │@repo/planner │    │
   │  (wallet)  │ │  (Claude (Anthropic))    │    │
   └──────┬─────┘ └──────┬───────┘    │
          │              │            │
          └──────────────┴────────────┘
                         │
                         ▼
                  ┌─────────────┐
                  │ @repo/agent │  ← the main loop
                  └──────┬──────┘
                         │
                         ▼
                    ┌──────────┐
                    │ apps/web │  ← reads what agent logged
                    └──────────┘
```

**Rule:** packages on the left/top get built first. Turbo handles the order automatically because of `"dependsOn": ["^build"]` in `turbo.json`.

---

## Step 1 — `@repo/data` (The Sensors)

**Files:** `oracle.ts`, `liquidity.ts`, `gas.ts`

**Job:** Fetch numbers from the outside world. No decisions here — just raw data.

### What it fetches:

```
Chainlink (on-chain)      →  ETH price, XAUT (gold) price
  └─ if Chainlink fails   →  CoinGecko REST API (fallback)

Ethereum node (on-chain)  →  current gas price (how expensive transactions are)
Uniswap V3 pool (on-chain)→  how much liquidity is in a trading pool
```

### Why does this exist as its own package?

Both `planner/` and `agent/` need prices. If price fetching lived inside `agent/`, `planner/` couldn't use it without importing `agent/` — which would create a circular dependency. Shared data code goes in `data/`.

### Key functions you'll call:

```ts
import { fetchPrices, fetchGasSnapshot, fetchPoolLiquidity } from "@repo/data";

const prices = await fetchPrices(provider);
// → { ethUsd: 2400, usdtUsd: 1.0001, xautUsd: 2050 }

const gas = await fetchGasSnapshot(provider);
// → { baseFeePerGas: 12n, gasPriceGwei: 13.5 }
```

---

## Step 2 — `@repo/wdk` (The Wallet)

**Files:** `wallet.ts`, `transactions.ts`, `accounts.ts`

**Job:** Talk to the blockchain wallet. Send money. Check balances.

### What WDK is

WDK stands for **Wallet Development Kit** — it's a library from Tether (`@tetherto/wdk-wallet-evm`). It turns a seed phrase (12 recovery words) into an Ethereum wallet that can sign transactions.

### The key thing to understand

The agent never holds a private key as a string in your code. The WDK library manages keys internally and wipes them from memory when you call `dispose()`. This is non-custodial — only the seed phrase owner can move funds.

### How wallet.ts connects to the rest

```
Your .env file
  AGENT_SEED_PHRASE=word1 word2 … word12
        │
        ▼
  createAgentWallet()          ← wallet.ts
        │
        ▼
  wallet.getPrimaryAccount()   ← returns a WalletAccountEvm
        │
        ├── account.getBalance()          → ETH balance (wei)
        ├── account.getTokenBalance(addr) → USDT or XAUT balance
        └── account.transfer({...})       → send a transaction
```

### The transfer shape (critical — wrong shape = error)

```ts
// CORRECT ✓
account.transfer({
  token: "0xUSDT_CONTRACT_ADDRESS",   // NOT "contractAddress"
  recipient: "0xRecipient",           // NOT "to"
  amount: 1_000_000n,                 // micro-USDT (1 USDT = 1,000,000)
});

// WRONG ✗
account.transfer({ contractAddress: "…", to: "…", amount: … });
```

---

## Step 3 — `@repo/planner` (The Brain)

**Files:** `goals.ts`, `actions.ts`, `openclaw.ts`, `prompts/`

**Job:** Look at all the market data and decide what the agent *should* do — using Claude (Anthropic).

### How it works internally

```
MarketObservation (prices + gas + opportunities)
        │
        ▼
buildPlanningMessage()   ← prompts/planning.ts assembles a prompt
        │
        ▼
ChatAnthropic (Claude (Anthropic), JSON mode)
        │  "Here is what I recommend..."
        ▼
Zod schema validation    ← makes sure GPT returned valid JSON
        │
        ▼
AgentAction[]            ← list of typed decisions
  e.g. { type: "ENTER_MARKET", marketId: "…", probability: 0.72, ev: 0.08 }
```

### What is an AgentAction?

It's a typed instruction. There are four kinds:

```ts
{ type: "ENTER_MARKET",  marketId: "…", amountMicroUsdt: 5_000_000n, probability: 0.72 }
{ type: "EXIT_MARKET",   marketId: "…" }
{ type: "REBALANCE",     fromToken: "USDT", toToken: "XAUT", amountMicroUsdt: 10_000_000n }
{ type: "HOLD" }  // do nothing this cycle
```

### What if there's no OpenAI key?

`openclaw.ts` has a `mockPlan()` fallback that always returns `HOLD`. The whole loop still runs — it just never trades. Useful for testing without spending API credits.

### What is "OpenClaw"?

It's the name given to the reasoning engine in this project. It uses LangChain.js as the framework to call Claude Sonnet via the Anthropic API. LangChain handles prompt templating, retries, and output parsing.

---

## Step 4 — `@repo/agent` (The Loop)

This is where everything comes together. Each file is one phase of the loop.

### `observe.ts` — gather signals

```ts
async function observe(account, rpcUrl, network): Promise<ObserveResult>
```

Calls `@repo/data` and `@repo/wdk` in parallel:

```
observe()
  ├── fetchPrices(provider)           → ETH/USDT/XAUT prices
  ├── fetchGasSnapshot(provider)      → current gas cost
  ├── getPortfolioSnapshot(account)   → wallet balances
  ├── fetchPoolLiquidity(provider)    → Uniswap depth
  ├── discoverOpportunities()         → open prediction markets (on-chain via MarketFactory)
  └── checkRiskGates(prices, gas)     → [warnings if USDT depegged or gas too high]
```

Returns one big `ObserveResult` object that all later phases read.

### `reason.ts` — ask Claude (Anthropic)

```ts
async function reason(signals: ObserveResult): Promise<ActionPlan>
```

A thin wrapper. Just calls `planner.plan(signals)` and returns the result. One line of real logic — the complexity lives in `@repo/planner`.

### `decide.ts` — apply hard rules

```ts
function decide(plan: ActionPlan, signals: ObserveResult): DecisionResult
```

Claude (Anthropic)'s suggestions go through a filter. This phase cannot be bypassed:

```
For each action in the plan:

  1. Is USDT depegged (price < $0.995)?        → reject everything
  2. Is gas above 100 gwei (network melting)?   → reject everything
  3. Did GPT say "just HOLD"?                   → approve only HOLD
  4. Is net EV < 2%?                            → reject this action
     (EV = probability × payout − 1 − gas cost)
  5. Is risk score > 70?                        → reject this action
  6. Is position > 5% of portfolio?             → clamp it down, not reject
  7. Is position < $1 after clamping?           → reject this action
  ─────────────────────────────────────────────────────────────
  Everything that passes → approved[]
  Everything that failed → rejected[] with a reason string
```

**Why separate decide from reason?** The LLM can hallucinate or be overconfident. Hard math in `decide.ts` is the safety net.

### `execute.ts` — do the actual thing

```ts
async function execute(decision: DecisionResult, account, dryRun): Promise<ExecutionResult[]>
```

Routes each approved action to the correct on-chain call:

```
ENTER_MARKET  → transferUSDT() to prediction market contract (via @repo/wdk)
EXIT_MARKET   → contract call to withdraw (not yet wired — placeholder)
REBALANCE     → swap USDT ↔ XAUT via transfer (partial implementation)
HOLD          → nothing (logs "no-op")
```

If `AGENT_DRY_RUN=true` (the default), execute logs what it *would* do but never sends a real transaction. Safe for testing.

### `learn.ts` — write it all down

```ts
async function learn(cycleData): Promise<void>
```

Saves the outcome of every cycle in three places simultaneously:

```
agent-loop.jsonl   ← plain text file, one JSON line per cycle (always works)
PostgreSQL         ← loop_outcomes table (structured queries, analytics)
Redis              ← agent:latest key (dashboard reads this) + publishes agent:events
```

Uses `Promise.allSettled` so if Postgres is down, the file log still saves. No single failure kills the cycle.

### `index.ts` — the main loop

```ts
while (true) {
  await runCycle();       // observe → reason → decide → execute → learn
  await sleep(60_000);   // wait 60 seconds
}
```

Also handles:
- Loading `.env` at startup
- Creating the wallet once (not every cycle)
- Catching errors so one bad cycle doesn't kill the agent
- Listening for Ctrl+C (SIGINT) to safely dispose the wallet

---

## The Smart Contracts (`packages/contracts/`)

The agent interacts with these Solidity contracts deployed on Ethereum:

```
User deposits USDT
        │
        ▼
  AgentVault.sol
  ├── agentWithdrawUsdt()  ← only the agent wallet can call this
  └── userWithdraw()       ← user can reclaim funds
        │
        ▼
  MarketFactory.sol
  └── createMarket()  →  PredictionMarket.sol
                           ├── buyYes(amount)   → mints OutcomeToken (YES)
                           ├── buyNo(amount)    → mints OutcomeToken (NO)
                           └── resolve(winner)  → winning tokens pay out
```

**PredictionMarket** is a binary AMM (Automated Market Maker). You bet YES or NO on an event. If you're right, you get a payout. The agent tries to predict which outcome is more likely and enter before the market price catches up.

**OutcomeToken** is a standard ERC-20 token representing one side of a bet.

**TypeChain** generates TypeScript types from the ABI so the agent's TypeScript code is fully typed when calling contract functions.

---

## The Dashboard (`apps/web/`)

A Next.js website that shows what the agent is doing in near-real-time.

```
Agent (every cycle)
  └── learn.ts sets Redis key: agent:latest = { portfolio, lastAction, … }
                                                        │
                                                        │  every 10 seconds
                                                        ▼
                                              apps/web/app/api/agent/route.ts
                                              (Next.js API route)
                                              reads Redis → returns JSON
                                                        │
                                                        ▼
                                              apps/web/app/dashboard/page.tsx
                                              (React client component)
                                              shows MetricCards, PortfolioChart, TradeTable
```

The dashboard doesn't talk to the blockchain directly. It only reads what the agent has already logged.

---

## The Infrastructure (`infra/`)

Two services, started with one command:

```bash
docker compose -f infra/docker-compose.yml up -d
```

| Service | Port | Purpose |
|---|---|---|
| PostgreSQL 16 | 5432 | Stores cycle history, trades, portfolio snapshots |
| Redis 7 | 6379 | Fast key-value cache; dashboard reads `agent:latest`; pub/sub for events |

`infra/init.sql` creates the database tables automatically on first startup:
- `loop_outcomes` — one row per agent cycle
- `trades` — one row per executed trade
- `portfolio_snapshots` — balance history
- `market_signals` — raw price/gas readings
- `agent_priors` — learned probability estimates (for future Bayesian updating)

---

## How to Trace a Single Cycle End-to-End

Here is exactly what happens when the agent wakes up:

```
1. index.ts           resolveConfig() reads .env
2. index.ts           createAgentWallet() loads seed phrase into WDK
3. index.ts           calls runCycle()

4. observe.ts         fetchPrices()     → ETH=$2400, USDT=$1.00, XAUT=$2050
5. observe.ts         fetchGasSnapshot()→ 13 gwei (cheap)
6. observe.ts         getPortfolioSnapshot() → 100 USDT, 0.05 ETH, 0 XAUT
7. observe.ts         discoverOpportunities() → 4 open prediction markets
8. observe.ts         checkRiskGates()  → [] (no gates triggered)

9. reason.ts          OpenClawPlanner.plan(signals)
10. openclaw.ts         buildPlanningMessage() assembles prompt
11. openclaw.ts         Claude (Anthropic) responds: "ENTER_MARKET on market_002, 70% confidence"
12. openclaw.ts         Zod validates the JSON response
13. reason.ts         returns ActionPlan { actions: [EnterMarketAction], recommendHold: false }

14. decide.ts         no risk gates → proceed
15. decide.ts         action = ENTER_MARKET, market_002
16. decide.ts           rawEV = 0.70 × 1.8 − 1 = 0.26
17. decide.ts           gasCostFraction = $0.50 / $50 = 0.01
18. decide.ts           netEV = 0.26 − 0.01 = 0.25  ✓ (> 0.02 min)
19. decide.ts           riskScore = 34  ✓ (< 70 max)
20. decide.ts           position = $5, cap = $5 (5% of $100)  ✓
21. decide.ts         approved: [EnterMarketAction]

22. execute.ts        AGENT_DRY_RUN=true → logs "would transfer 5 USDT to market_002"
    (if dry run is off → account.transfer({ token: USDT_ADDRESS, recipient: market, amount: 5_000_000n }))

23. learn.ts          writes to agent-loop.jsonl
24. learn.ts          INSERT INTO loop_outcomes VALUES (…)
25. learn.ts          Redis SET agent:latest = {…}
26. learn.ts          Redis PUBLISH agent:events {…}

27. index.ts          sleep 60 seconds → goto step 3
```

---

## Where to Start When Building Something Like This

If you were building this from scratch, the order to build would be:

```
1. infra/         → get Postgres + Redis running first (docker compose up)
2. packages/data/ → write price/gas fetchers, test them in isolation
3. packages/wdk/  → wrap the wallet library, test getBalance()
4. packages/planner/ → write the prompt, test with Claude (Anthropic) mock first
5. packages/contracts/ → write + deploy Solidity contracts to testnet
6. packages/agent/ → wire observe→reason→decide→execute→learn
7. apps/web/      → build the dashboard last, everything else is an API
```

This matches the dependency order. You can't build `agent/` until `data/`, `wdk/`, and `planner/` all work — because `agent/` imports all of them.

---

## Glossary

| Term | Plain English |
|---|---|
| **EV (Expected Value)** | Average profit per dollar risked. EV = 0.08 means expect 8 cents profit per dollar. |
| **Basis points (bps)** | 1 bps = 0.01%. 200 bps = 2%. |
| **Wei** | Smallest ETH unit. 1 ETH = 1,000,000,000,000,000,000 wei (1e18). |
| **Micro-USDT** | Smallest USDT unit. 1 USDT = 1,000,000 micro-USDT (6 decimals). |
| **Seed phrase** | 12 or 24 words that represent a wallet. Anyone with these words owns the wallet. |
| **Non-custodial** | The agent controls funds but cannot steal them — only the seed phrase owner can. |
| **AMM** | Automated Market Maker. A smart contract that sets prices using a formula instead of an order book. |
| **ERC-20** | The standard interface for fungible tokens on Ethereum. USDT and XAUT are ERC-20 tokens. |
| **ABI** | Application Binary Interface — the recipe for calling a smart contract's functions. |
| **TypeChain** | Tool that reads ABI files and generates TypeScript types for contract calls. |
| **Monorepo** | One Git repo containing multiple packages/apps that can import each other. |
| **Turborepo** | Build tool that understands the monorepo dependency graph and only rebuilds what changed. |
| **ESM** | ES Modules — the modern JavaScript import/export system (`import x from "y"`). All packages here use ESM. |
