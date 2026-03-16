# @repo/agent — Autonomous DeFi Agent Loop

The core runtime. Implements the **Observe → Reason → Decide → Execute → Learn** cycle that runs continuously on-chain.

## Loop

```
┌─────────────────────────────────────────────────────┐
│                      main()                         │
│                                                     │
│  observe()  →  reason()  →  decide()  →  execute()  │
│       └──────────────── learn() ───────────────────┘│
│                  (every CYCLE_INTERVAL_MS)           │
└─────────────────────────────────────────────────────┘
```

## Modules

| File | Purpose |
|---|---|
| `index.ts` | Entry point; `main()` loop, graceful shutdown (SIGINT/SIGTERM) |
| `observe.ts` | Fetches prices, gas, portfolio, liquidity, and market opportunities |
| `reason.ts` | Thin wrapper that calls `OpenClawPlanner.plan()` |
| `decide.ts` | Global risk gates + per-action EV / position-size filtering |
| `execute.ts` | Routes approved actions to WDK transfers / contract calls |
| `learn.ts` | Persists cycle outcomes to JSON log, PostgreSQL, and Redis |

## Risk Gates (decide.ts)

| Gate | Threshold |
|---|---|
| Min ETH for gas | 0.005 ETH |
| Max position size | 5 % of portfolio |
| Max risk score | 70 / 100 |
| Min EV | 0.02 |
| USDT depeg halt | price < $0.995 |
| Network congestion halt | base fee > 100 gwei |

## Persistence (learn.ts)

- **JSON log** — `agent-loop.jsonl` appended each cycle
- **PostgreSQL** — `loop_outcomes` table (see `infra/init.sql`)
- **Redis** — publishes to `agent:events` channel; sets `agent:latest` key (5-min TTL)

## Running

```bash
# Development (hot-reload)
npm run dev -w packages/agent

# Production (after build)
npm run start -w packages/agent
```

## Environment Variables

| Variable | Description |
|---|---|
| `SEED_PHRASE` | BIP-39 wallet mnemonic |
| `ETH_RPC_URL` | Ethereum RPC endpoint |
| `OPENAI_API_KEY` | GPT-4o key (optional) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `CYCLE_INTERVAL_MS` | Loop interval in ms (default `60000`) |
| `MARKET_FACTORY_ADDRESS` | Deployed MarketFactory contract address |
