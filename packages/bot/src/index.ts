// Bots for the Shadowverse: Evolve engine. They play through the core's public API only: the player's view, its
// decisions and copies of the game — determinized ones (what the player knows), or for the hard bot the real game, which
// it reads on purpose.

export { GreedyBot, type GreedyBotOptions, type BotStats } from "./greedy";
export { PlannerBot, type PlannerBotOptions } from "./planner";
export { createBot, BOT_LEVELS, MEDIUM_OPTIONS, HARD_OPTIONS, MEDIUM_BETA_OPTIONS, HARD_BETA_OPTIONS, LEADER_CURVE, type Bot, type BotEvaluation, type BotLevel } from "./levels";
export { curveScore, redrawByExpectation, redrawKnowingDeck, type CurveCard } from "./mulligan";
export { evaluate, curveValue, exactResults, weightsEvaluator, DEFAULT_WEIGHTS, type EvalWeights, type Evaluator, type LeaderCurve } from "./evaluate";
export { searchSureLethal, lethalWithinReach, lineWins, adaptStep, stepOf, type LethalStep, type LethalSearchOptions, type LethalResult, type Responder } from "./lethal";
export { planBranches } from "./branches";
export { fastAnswer, lookupFromView, lookupFromReader, staticValue, type CardFacts, type CardLookup } from "./policy";
export { candidateAnswers } from "./candidates";
