// Local worker-to-page presentation extensions. Keep engine/protocol.ts unchanged: it is fingerprinted.
import type { CardId, DefId, PlayerId } from "@sve/core";
import type { CardInfo } from "../engine/protocol";
import type { FromWorker as EngineMessage, GameUpdate as EngineUpdate } from "../engine/protocol";

/** Additional presentation data for a visible instance. Type, stats and gifts remain in CardView. */
export interface CardRuntimeDetails {
  enteredFieldThisTurn: boolean;
  cannotAttack: boolean;
  cannotAttackLeader: boolean;
  cannotDealDamage: boolean;
}

export interface GameUpdate extends EngineUpdate {
  /** Computed synchronously from the session and the final visible view being sent. */
  cardDetails: Record<CardId, CardRuntimeDetails>;
  /** Local presentation only; optional for older GUI fixtures/messages. The host always supplies both. */
  pendingAbilities?: Record<string, AbilityDisplayContext>;
  effectContext?: AbilityDisplayContext | null;
}

/** Identity is kept independently of language; the page resolves text when its card language changes. */
export interface AbilityDisplayContext {
  instanceId?: string;
  kind?: "automatic" | "activated" | "spell" | "cardPlay";
  pendingId?: string;
  controller: PlayerId;
  source: CardId;
  sourceDef: DefId;
  /** Absent for the card's play process (playOptions are not Core ability indexes). */
  abilityIndex?: number;
  sourceCard?: CardInfo;
  providerDef?: DefId;
  timing?: string;
  origin: "printed" | "keyword" | "granted" | "equipment" | "delayed";
  keyword?: string;
  textRef?: { def: DefId; timing: string; rank: number; count: number; quoted?: boolean };
  modeIds?: string[];
  playOptionId?: string;
  playOptionLabel?: string;
}

export type AbilityUpdate = EngineUpdate & Pick<GameUpdate, "pendingAbilities" | "effectContext">;

export type FromWorker = Exclude<EngineMessage, { kind: "update" }> | { kind: "update"; update: GameUpdate };
