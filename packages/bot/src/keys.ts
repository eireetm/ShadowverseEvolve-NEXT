import type { PlayerView } from "./core";

const CARD_ID = /^c\d+$/;
const isCardId = (s: string) => s.charCodeAt(0) === 99 && CARD_ID.test(s);
/** Lists whose order says nothing about the position (a decision's choices). */
const UNORDERED = new Set(["actions", "candidates", "candidateDefs", "options", "mandatory", "peek"]);

/**
 * A key for a position as its viewer sees it that is the same however the position was reached. A card gets a new id in each
 * zone it moves to (CR 4.1.4), so playing two cards in either order leaves the same cards under different ids. Here every
 * reference to a card is replaced by the card as it is (everything the view shows of it, the cards it refers to by what they
 * are; a hidden card is just hidden), and the cards of a zone and the choices of a decision are in a fixed order. Two cards
 * are interchangeable only if they look the same: an attack on the damaged one of two copies stays apart from one on the
 * other. Plans that end in one position count as one, in the beam and among the plans compared after the opponent's reply.
 * (Following a plan in the real game compares exact views: the ids its next answer names must be the same cards.)
 */
export function positionKey(view: PlayerView): string {
  const cards = new Map<string, Record<string, unknown>>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) for (const x of value) collect(x);
    else if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      if (typeof o.id === "string" && isCardId(o.id)) cards.set(o.id, o);
      for (const x of Object.values(o)) if (x && typeof x === "object") collect(x);
    }
  };
  collect(view.players);
  collect(view.resolution);

  const serialize = (value: unknown, ref: (id: string) => string, key = ""): string => {
    if (typeof value === "string") return JSON.stringify(isCardId(value) ? `#${ref(value)}` : value);
    if (Array.isArray(value)) {
      const items = value.map((x) => serialize(x, ref));
      const unordered =
        UNORDERED.has(key) ||
        (value.length > 1 && value.every((x) => (typeof x === "string" ? isCardId(x) : !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string")));
      return `[${(unordered ? items.sort() : items).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || (k === "id" && typeof v === "string" && isCardId(v))) continue;
        parts.push(`${JSON.stringify(k)}:${serialize(v, ref, k)}`);
      }
      return `{${parts.join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };

  // A card as it is, the cards it refers to (an evolved follower's evolve card, a linked card) by what they are.
  const defOf = (id: string) => {
    const c = cards.get(id);
    return !c || c.hidden === true || typeof c.def !== "string" ? "?" : c.def;
  };
  const signatures = new Map<string, string>();
  const signature = (id: string): string => {
    let s = signatures.get(id);
    if (s === undefined) {
      const c = cards.get(id);
      s = !c || c.hidden === true ? "?" : serialize(c, defOf);
      signatures.set(id, s);
    }
    return s;
  };
  return serialize(view, signature);
}

/** The zones a side of a view lists card by card (the deck is a count, CR 4.1.2.1). */
const LISTED_ZONES = ["hand", "field", "ex", "cemetery", "banished", "evolveDeck", "evolveZone", "raceZone", "driveZone", "triggerZone", "equipmentZone"] as const;

/**
 * What a card is as `view`'s player sees it, by id (undefined: not listed in the view): where it is (the side and the zone)
 * and everything the view shows of it as positionKey reads a card — the cards it refers to (an evolved follower's evolve
 * card, a linked card, a given ability's source) by definition — except its printing, which no rule reads; a hidden card is
 * where it is and "?" (or the card its player remembers, CardInstance.knownBy). Two cards with one signature are the same
 * card for every choice their player can make: picking either leaves positions positionKey can't tell apart but by the
 * printing. positionKey itself is left as it is (the beam's and the plans' keys).
 */
export function cardSignatures(view: PlayerView): (id: string) => { signature: string; hidden: boolean } | undefined {
  const cards = new Map<string, { card: Record<string, unknown>; where: string }>();
  const list = (side: number, zone: string, xs: readonly unknown[]) => {
    for (const x of xs) {
      const c = x as Record<string, unknown>;
      if (typeof c.id === "string") cards.set(c.id, { card: c, where: `${side}|${zone}` });
    }
  };
  for (const [side, p] of view.players.entries()) {
    if (p.leader) list(side, "leader", [p.leader]);
    for (const zone of LISTED_ZONES) list(side, zone, p[zone]);
  }
  list(-1, "resolution", view.resolution);
  const defOf = (id: string) => {
    const c = cards.get(id)?.card;
    return !c || c.hidden === true || typeof c.def !== "string" ? "?" : c.def;
  };
  const serialize = (value: unknown, key = ""): string => {
    if (typeof value === "string") return JSON.stringify(isCardId(value) ? `#${defOf(value)}` : value);
    if (Array.isArray(value)) {
      const items = value.map((x) => serialize(x));
      return `[${(UNORDERED.has(key) ? items.sort() : items).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || k === "printing" || (k === "id" && typeof v === "string" && isCardId(v))) continue;
        parts.push(`${JSON.stringify(k)}:${serialize(v, k)}`);
      }
      return `{${parts.join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };
  const memo = new Map<string, { signature: string; hidden: boolean }>();
  return (id) => {
    const got = memo.get(id);
    if (got !== undefined) return got;
    const at = cards.get(id);
    if (!at) return undefined;
    const c = at.card;
    const known = c.known as { def?: unknown } | undefined;
    const hidden = c.hidden === true;
    const s = { signature: hidden ? `${at.where}|?${known && typeof known.def === "string" ? `:${known.def}` : ""}` : `${at.where}|${serialize(c)}`, hidden };
    memo.set(id, s);
    return s;
  };
}
