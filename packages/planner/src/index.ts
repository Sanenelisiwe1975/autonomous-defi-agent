/**
 * @file index.ts
 * @description Public API surface of @repo/planner.
 * @license Apache-2.0
 */

export {
  OpenClawPlanner,
  getPlanner,
  type PlannerInput,
  type PlannerConfig,
} from "./openclaw.js";

export {
  AGENT_GOALS,
  evaluateGoals,
  getUnsatisfiedGoals,
  formatGoalSummary,
  GoalSchema,
  GoalSetSchema,
  type Goal,
  type GoalSet,
} from "./goals.js";

export {
  ActionPlanSchema,
  ActionSchema,
  EnterMarketActionSchema,
  ExitMarketActionSchema,
  RebalanceActionSchema,
  HoldActionSchema,
  calculateRawEV,
  generateActionId,
  microUsdtToDisplay,
  type ActionPlan,
  type AgentAction,
  type EnterMarketAction,
  type ExitMarketAction,
  type RebalanceAction,
  type HoldAction,
} from "./actions.js";

export {
  SYSTEM_PROMPT,
  MARKET_ANALYSIS_PROMPT,
} from "./prompts/system.js";

export {
  buildPlanningMessage,
  formatPricesForPrompt,
  formatGasForPrompt,
  formatLiquidityForPrompt,
  formatOpportunitiesForPrompt,
  type RawOpportunity,
} from "./prompts/planning.js";
