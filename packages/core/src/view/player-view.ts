import type { DefId, PrintingId, CardType, Universe } from "../model/card";
import type { Decision } from "../model/decision";
import type { CardId, PlayerId } from "../model/ids";
import type { Keyword } from "../model/keyword";
import type { AttackState, GameResult, Phase, PlayerZone } from "../model/state";
import type { Env } from "../engine/state/access";
import { abilitiesLostAt, characteristics, isBoxed } from "../engine/state/characteristics";
import { giftsOf, type Gift } from "./gifts";
import { cardVisibleTo } from "./visibility";

/** A card whose information the viewer may see. */
export interface CardView {
  id: CardId;
  hidden: false;
  printing: PrintingId;
  def: DefId;
  name: string;
  type: CardType;
  owner: PlayerId;
  controller: PlayerId;
  engaged: boolean;
  faceUp: boolean;
  /** CR 2.14.3 — a double-faced card showing its back face (its information is the back face's). */
  backFace: boolean;
  cost: number | null;
  attack: number | null;
  defense: number | null;
  damage: number;
  keywords: readonly Keyword[];
  /** Linked evolve-zone card, if evolved (CR 5.16.1). */
  evolvedWith: CardId | null;
  superEvolved: boolean;
  /** CR 5.31 — it is Boxed (lost its abilities, doesn't refresh in its controller's start phase). */
  boxed: boolean;
  /** CR 10.9.1.2 — the abilities given to it, each with the card whose text quotes it (view/gifts.ts). */
  gifts: readonly Gift[];
  /** It lost all its abilities, printed and given before ("loses all abilities", BP05-061; Boxed, CR 5.31.2). */
  abilitiesLost: boolean;
  /** CR 15.1 */
  counters: Readonly<Record<string, number>>;
  /** A race-zone, drive-zone or equipment-zone card: the card on the field it is linked to (CR 14.2.1.1, 14.4.9.2, 14.5.2.2). */
  linkedTo: CardId | null;
}

/** A card the viewer may not look at (only that it exists). */
export interface HiddenCardView {
  id: CardId;
  hidden: true;
  /**
   * The card, when the viewer was shown it before and remembers which it is (CardInstance.knownBy: a card searched and
   * revealed into a hand, a follower returned to its owner's hand). Only the zones the view lists card by card can carry it;
   * a remembered deck card is not listed (the deck is a count, CR 4.1.2.1): determinize() keeps it, and it shows here once
   * it is in one of those zones (e.g. drawn: it was the top card, CR 5.10.1).
   */
  known?: { def: DefId; printing: PrintingId };
}

export interface PlayerSideView {
  id: PlayerId;
  leader: CardView | null;
  leaderDefense: number;
  playPoints: number;
  maxPlayPoints: number;
  evolutionPoints: number;
  superEvolutionPoints: number;
  turnsPassed: number;
  /** CR 4.1.2.1 — card counts are always public. Deck contents / order never are. */
  deckCount: number;
  hand: (CardView | HiddenCardView)[];
  /** Faceup cards; a facedown one (a Starting Amulet before the redraws, CR 14.4.3) is hidden from the opponent (4.2.3.2). */
  field: (CardView | HiddenCardView)[];
  ex: CardView[];
  cemetery: CardView[];
  banished: (CardView | HiddenCardView)[];
  evolveDeck: (CardView | HiddenCardView)[];
  evolveZone: CardView[];
  /** CR 4.13–4.16 — the collaboration zones (public). */
  raceZone: CardView[];
  driveZone: CardView[];
  triggerZone: CardView[];
  equipmentZone: CardView[];
  /** CR 6.1.1.5 — the universe the deck is based on, or null for a class-based deck (public). */
  universe: Universe | null;
}

export interface PlayerView {
  viewer: PlayerId;
  turn: number;
  phase: Phase;
  activePlayer: PlayerId;
  firstPlayer: PlayerId | null;
  result: GameResult | null;
  attack: AttackState | null;
  players: [PlayerSideView, PlayerSideView];
  resolution: CardView[];
  /** The pending decision if it is the viewer's; otherwise null. */
  decision: Decision | null;
  /** Who the game is waiting for, if anyone. */
  waitingFor: PlayerId | null;
}

function cardView(env: Env, id: CardId): CardView {
  const c = env.state.cards[id]!;
  const ch = characteristics(env, id);
  return {
    id,
    hidden: false,
    printing: c.printing,
    def: c.def,
    name: ch.name,
    type: ch.type,
    owner: c.owner,
    controller: c.controller,
    engaged: c.engaged,
    faceUp: c.faceUp,
    backFace: c.backFace,
    cost: ch.cost,
    attack: ch.attack,
    defense: ch.defense,
    damage: c.damage,
    keywords: ch.keywords,
    evolvedWith: c.evolvedWith,
    superEvolved: c.superEvolved,
    boxed: isBoxed(env.state, id),
    gifts: giftsOf(env, id),
    abilitiesLost: abilitiesLostAt(env.state, id) !== null,
    counters: { ...c.counters },
    linkedTo: c.linkedTo ?? null,
  };
}

/** Visible if the zone allows it (CR 4.1.2) or it is currently revealed (CR 5.21). */
function viewFor(env: Env, viewer: PlayerId, id: CardId): CardView | HiddenCardView {
  const card = env.state.cards[id]!;
  const visible = cardVisibleTo(card, viewer) || env.state.revealed.includes(id);
  if (visible) return cardView(env, id);
  return card.knownBy?.includes(viewer) ? { id, hidden: true, known: { def: card.def, printing: card.printing } } : { id, hidden: true };
}

function sideView(env: Env, viewer: PlayerId, p: PlayerId): PlayerSideView {
  const ps = env.state.players[p];
  const all = (zone: PlayerZone) => ps.zones[zone].map((id) => cardView(env, id));
  const some = (zone: PlayerZone) => ps.zones[zone].map((id) => viewFor(env, viewer, id));
  const leaderId = ps.zones.leader[0];
  return {
    id: p,
    leader: leaderId === undefined ? null : cardView(env, leaderId),
    leaderDefense: ps.leaderDefense,
    playPoints: ps.playPoints,
    maxPlayPoints: ps.maxPlayPoints,
    evolutionPoints: ps.evolutionPoints,
    superEvolutionPoints: ps.superEvolutionPoints,
    turnsPassed: ps.turnsPassed,
    deckCount: ps.zones.deck.length,
    hand: some("hand"),
    field: some("field"),
    ex: all("ex"),
    cemetery: all("cemetery"),
    banished: some("banished"),
    evolveDeck: some("evolveDeck"),
    evolveZone: all("evolveZone"),
    raceZone: all("raceZone"),
    driveZone: all("driveZone"),
    triggerZone: all("triggerZone"),
    equipmentZone: all("equipmentZone"),
    universe: ps.universe,
  };
}

/** Build the information available to `viewer` (CR 4.1.2). */
export function playerView(env: Env, viewer: PlayerId, decision: Decision | null): PlayerView {
  const s = env.state;
  return {
    viewer,
    turn: s.turn,
    phase: s.phase,
    activePlayer: s.activePlayer,
    firstPlayer: s.firstPlayer,
    result: s.result,
    attack: s.attack,
    players: [sideView(env, viewer, 0), sideView(env, viewer, 1)],
    resolution: s.resolution.map((id) => cardView(env, id)),
    decision: decision && decision.player === viewer ? decision : null,
    waitingFor: decision ? decision.player : null,
  };
}
