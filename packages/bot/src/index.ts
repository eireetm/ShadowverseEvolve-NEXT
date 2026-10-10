// Bots for the Shadowverse: Evolve engine. They play through the core's public API only: the player's view, its
// decisions and copies of the game — determinized ones (what the player knows), or for the hard bot the real game, which
// it reads on purpose.

export { GreedyBot, type GreedyBotOptions, type BotStats } from "./greedy";
export { PlannerBot, type PlannerBotOptions } from "./planner";
export { createBot, BOT_LEVELS, MEDIUM_OPTIONS, HARD_OPTIONS, MEDIUM_BETA_OPTIONS, LEADER_CURVE, type Bot, type BotEvaluation, type BotLevel } from "./levels";
export { curveScore, redrawByExpectation, redrawKnowingDeck, type CurveCard } from "./mulligan";
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
