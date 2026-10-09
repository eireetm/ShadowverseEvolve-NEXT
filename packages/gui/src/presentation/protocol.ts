// Local worker-to-page presentation extensions. Keep engine/protocol.ts unchanged: it is fingerprinted.
import type { CardId } from "@sve/core";
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
}

export type FromWorker = Exclude<EngineMessage, { kind: "update" }> | { kind: "update"; update: GameUpdate };
