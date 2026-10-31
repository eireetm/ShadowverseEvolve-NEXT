// Bots for the Shadowverse: Evolve engine. They play through the core's public API only: the player's view, its
// decisions and copies of the game — determinized ones (what the player knows), or for the hard bot the real game, which
// it reads on purpose.

export { GreedyBot, type GreedyBotOptions, type BotStats } from "./greedy";
export { PlannerBot, type PlannerBotOptions, type ConditionalOptions } from "./planner";
export {
  createBot,
  createPresetBot,
  fixOptions,
  fixIdentities,
  presetIdentities,
  presetSearchIdentity,
  BOT_LEVELS,
  BOT_PRESETS,
  MEDIUM_OPTIONS,
  HARD_OPTIONS,
  MEDIUM_BETA_OPTIONS,
  MEDIUM_NEXT,
  HARD_NEXT,
  MEDIUM_V2,
  HARD_NEXT_MACRO,
  MEDIUM_NEXT_MACRO,
  FIX_DEFAULTS,
  LEADER_CURVE,
  type Bot,
  type BotEvaluation,
  type BotLevel,
  type BotPreset,
  type FixParams,
} from "./levels";
export { curveScore, redrawByExpectation, redrawKnowingDeck, type CurveCard } from "./mulligan";
export { PP1_NAME, PP1_DEFAULTS, PP1_KEYS, pp1Evaluator, pp1GreedyParams, pp1Identity, pp1Parts, pp1Problems, maxPpValue, quickReserve, ppMode, type Pp1Params, type Pp1Parts, type PpMode } from "./eval-pp";
export { DANGER_NAME, DANGER_DEFAULTS, DANGER_KEYS, danger, dangerIdentity, dangerProblems, dangerStartParams, dangerTerm, leaderDamage, lossChance, threats, type DangerParams, type Threat, type ThreatWhen, type Attacker, type WardBlock } from "./danger";
export { QUICK_END, quickIdentity, quickBonusProblem, endWindowPoints, PpLine, type QuickWindowStats } from "./quick-window";
export {
  COND_SCOPES,
  COND_DEFAULTS,
  condIdentity,
  condProblems,
  fanfaresOf,
  openWatch,
  openEvolveWatch,
  evolveAbilitiesOf,
  feedWatch,
  answeredInWatch,
  judgeWatch,
  coveredFanfares,
  ConditionalCharges,
  type CondScope,
  type CondParams,
  type CondGates,
  type CondState,
  type CondMark,
  type ConditionalStats,
  type CoveredFanfare,
  type FanfareInfo,
  type FanfareOutcome,
  type PlayJudgment,
  type Watch,
  type WasteKind,
} from "./conditional";
export { tableGates, resolveGatesOf, gateMet, type TableGates } from "./conditional-gates";
export { bundledCardTable, bundledGates } from "./card-table";
export { SIM_DEFAULTS, SIM_KEYS, SIM_EXTRA_KEYS, SIM_ADAPTIVE, FINISHED, simMulligan, simIdentity, simExtraIdentity, simProblems, simExtraProblems, simSampleLimit, simEstimate, simStopsBefore, simHorizon, playOpening, plansItself, type SimParams, type SimOutcome, type SimContext, type MulliganStats, type MulliganWorld, type MulliganDecision, type Playout, type Agent } from "./mulligan-sim";
export { setupSample, setupWorld, hiddenPools, stepBack, type SetupSample } from "./setup-sample";
export { MACRO_DEFAULTS, MACRO_RANGES, macroProblems, macroIdentity, actionsOf, completionKey, keptCompletions, type MacroOptions, type MacroNode } from "./macro-steps";
export { CLOSE_DEFAULTS, closeProblems, closeIdentity, isClose, type CloseSampleOptions } from "./close-samples";
export { deckOverlap, fixedTurnOrder, ownDeckList, turnOrderFor, turnOrderIdentity, turnOrderProblems, type TurnOrderChoice, type TurnOrderEntry, type TurnOrderTable } from "./turn-order";
export { evaluate, curveValue, exactResults, weightsEvaluator, DEFAULT_WEIGHTS, type EvalWeights, type Evaluator, type LeaderCurve } from "./evaluate";
export { searchSureLethal, lethalWithinReach, lethalFirstModel, lineWins, adaptStep, stepOf, type LethalStep, type LethalSearchOptions, type LethalResult, type Model, type Responder } from "./lethal";
export { positionKey } from "./keys";
export { planBranches } from "./branches";
export { fastAnswer, lookupFromView, lookupFromReader, staticValue, type CardFacts, type CardLookup } from "./policy";
export { candidateAnswers } from "./candidates";
export {
  CARD_FEATURES_VERSION,
  CARD_FEATURE_COLUMNS,
  CARD_FEATURE_COLUMNS_V1,
  FX_FAMILY_COLUMNS,
  AMOUNT_COLUMNS,
  COND_COLUMNS,
  POOLED_COLUMNS,
  BRIEF_COLUMNS,
  KNOWN_SCRIPT_KEYS,
  cardFeatureRow,
  cardFeatureTable,
  buildCardFeatureFile,
  cardFeatureFileText,
  refPartial,
  refNeeded,
  refFrom,
  type AnalyzedRef,
  type CardFeatureFile,
  type CardFeatureTable,
  type CardRef,
  type RefFilter,
  type RefTest,
  type ScriptAnalysis,
} from "./card-features";
export { ENCODER_VERSION, ENCODER_LAYOUT, PLAYER_TYPES_V1, COUNTER_KINDS, encode, decode, describe, encoderSchema, infoDefOf, knownDeck, type EncoderContext, type EncoderSchema, type EncodeDiagnostics, type KnownDeck, type PlayerType, type DescribeNames } from "./encoder";
export {
  ENCODER_V2_VERSION,
  ZONES_V2,
  GLOBAL_COLUMNS_V2,
  CARD_HEADER_V2,
  CARD_BODY_COLUMNS_V2,
  CARD_WIDTH_V2,
  PILE_COLUMNS_V2,
  GDEF_HEADER_V2,
  GDEF_COLUMNS_V2,
  POOL_LAYOUT_V2,
  encoderV2Schema,
  prepareV2,
  gdefRow,
  gdIndexOf,
  encodeV2,
  poolV2,
  decodeV2,
  describeV2,
  type EncoderV2Context,
  type EncoderV2Schema,
  type PreparedV2,
  type EncodedV2,
  type DescribeV2Names,
} from "./encoder-v2";
export { REL_COLUMNS_V2, emptyDiagnosticsV2, refDomain, cardToken, evaluateRef, refClass, odds, meets, e16, defFacts, IN_PLACE, type EncodeDiagnosticsV2, type RefTrace, type RefDomain, type RefToken } from "./encoder-v2-refs";
