# @repo/planner — OpenClaw Reasoning Engine

LangChain.js + GPT-4o planning layer that converts market observations into ranked, validated `AgentAction` objects.

## Architecture

```
MarketObservation
      │
      ▼
buildPlanningMessage()   ← prompts/planning.ts
      │
      ▼
ChatOpenAI (GPT-4o, JSON mode)
      │
      ▼
Zod schema validation    ← actions.ts
      │
      ▼
AgentAction[]            (ENTER_MARKET | EXIT_MARKET | REBALANCE | HOLD)
```

## Modules

| File | Purpose |
|---|---|
| `goals.ts` | Portfolio allocation targets (50 % prediction markets, 30 % yield, 10 % LP, 10 % XAU₮) |
| `actions.ts` | Zod schemas for all action types; `calculateRawEV()`, `generateActionId()` |
| `openclaw.ts` | `OpenClawPlanner` class; `mockPlan()` fallback when OpenAI key is absent |
| `prompts/system.ts` | System prompt — agent identity, risk principles, min EV threshold `> 0.02` |
| `prompts/planning.ts` | `buildPlanningMessage()` — assembles full prompt from live market data |

## Usage

```ts
import { OpenClawPlanner } from "@repo/planner";

const planner = new OpenClawPlanner();
const actions = await planner.plan(observation);
// [{ type: "ENTER_MARKET", marketId: "…", ev: 0.08, … }]
```

If `OPENAI_API_KEY` is not set the planner falls back to `mockPlan()` which always returns a `HOLD` action — useful for local development without spending API credits.

## EV Formula

```
EV = (probability × payoutMultiplier) − 1 − gasCostFraction
```

Actions with `EV < 0.02` are filtered out by the decision engine in `@repo/agent`.

## Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | GPT-4o API key (optional — falls back to mock) |
| `OPENAI_MODEL` | Model override (default `gpt-4o`) |
