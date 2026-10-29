import { describe, expect, it } from "vitest";
import type { CardId, GameSession } from "../../src";
import { drive, scenario, type DriveSpec, type Driver } from "../../src/testing";
import { playCost, playCostAsPlayed } from "../../src/engine/costs";
import { playVariants, specifiable, waysInResolution } from "../../src/engine/flow/play-card";
import type { G } from "../../src/engine/runtime/context";
import { moveCards, withCardInResolution } from "../../src/engine/state/zones";
import type { PlayOption, SpellAbility } from "../../src/script/types";
import { cardEngine } from "../helpers";

// CR 10.6.2.1 — a card being played is first moved to the resolution zone (a new card, 4.1.4); its choices, targets, cost
// and the field are decided after that (10.6.2.2–10.6.2.6). The engine checks a play with the card there
// (withCardInResolution), so it offers only plays it can carry out (10.6.2.1.2) and they cost what they will cost. V1 is
// 1c 2/2 (Neutral).
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const n = (count: number, id = "V1") => Array<string>(count).fill(id);
const env = (s: GameSession) => (s as unknown as { g: G }).g;
const JEWELS = "BP18-T03"; // "For the rest of this turn, you may play cards from your banished zone"
const RULENYE = "BP05-070"; // "any spell an opponent plays costs 1 more" (its ruling: also one played for 0 by an effect)
const CHESS4 = ["BP03-052", "BP03-046", "BP03-042", "BP03-039"];
const SPELL7 = "BP06-047"; // a spell Merlin can't select (7)
const OCTRICE = { card: "BP05-018", evolvedInto: "BP05-019" };

/** BP01-053 Merlin's On Evolve (with an evolution point): play a spell costing 3 or less from the cemetery for 0. */
const merlin = (cemetery: string[], playPoints: number, opp: DriveSpec["opp"] = {}, field: string[] = []): Driver =>
  d({ me: { field: ["BP01-052", ...field], evolveDeck: ["BP01-053"], cemetery, deck: n(3, "BP03-046"), evolutionPoints: 1, playPoints }, opp }).evolve("BP01-052", { ep: true });

describe("a card being played is in the resolution zone when its targets and cost are decided (CR 10.6.2.1)", () => {
  it("BP18-042 Ginger played from the banished zone doesn't count itself (BP18-T03 Q1, BP18-046 Q2)", () => {
    const spec = (banished: number, pp: number): DriveSpec => ({ me: { ex: [JEWELS], banished: ["BP18-042", ...n(banished - 1)], playPoints: pp } });
    expect(d(spec(10, 1)).play(`${JEWELS}@ex`).canPlay("BP18-042@banished")).toBe(false); // 9 others: costs 1, 0 PP left
    const t = d(spec(10, 2)).play(`${JEWELS}@ex`).play("BP18-042@banished");
    expect([t.field(), t.pp()]).toEqual([["BP18-042"], 0]);
    expect(d(spec(11, 1)).play(`${JEWELS}@ex`).play("BP18-042@banished").field()).toEqual(["BP18-042"]);
  });

  it("BP17-051 Convenant Mage played from the banished zone doesn't count itself", () => {
    const spec = (pp: number): DriveSpec => ({ me: { ex: [JEWELS], banished: ["BP17-051", "V1", "V1"], deck: ["V3"], playPoints: pp } });
    expect(d(spec(2)).play(`${JEWELS}@ex`).canPlay("BP17-051@banished")).toBe(false); // 2 others: costs 2, 1 PP left
    expect(d(spec(3)).play(`${JEWELS}@ex`).play("BP17-051@banished").pp()).toBe(0);
  });

  it("BP13-053 Sacrifice played from the cemetery for 0 doesn't count itself: with Rulenye's +1 it costs 1 (BP05-070 Q2–Q3)", () => {
    const t = merlin(["BP13-053", ...CHESS4], 1, { field: [RULENYE] }, ["BP03-051"]);
    expect([t.field(), t.cemetery().includes("BP13-053"), t.pp()]).toEqual([["BP01-052", "BP03-051"], true, 0]); // nothing happens
    const paid = merlin(["BP13-053", ...CHESS4], 2, { field: [RULENYE] }, ["BP03-051"]);
    expect([paid.cemetery().includes("BP03-051"), paid.pp()]).toEqual([true, 0]); // played for 0 + 1: the Rook destroyed
  });

  it("BP21-053 Aqueous Sphere played from the cemetery: Spellchain (10) counts 9 (BP01-053 Q1)", () => {
    expect(merlin(["BP21-053", ...n(9, SPELL7)], 1, { field: [RULENYE] }).field("opp")).toEqual([RULENYE]); // costs 1: not played
    expect(merlin(["BP21-053", ...n(9, SPELL7)], 2, { field: [RULENYE] }).field("opp")).toEqual([]); // 4 damage
    expect(merlin(["BP21-053", ...n(9, SPELL7)], 2, { field: [RULENYE, RULENYE] }).field("opp")).toEqual([RULENYE, RULENYE]); // costs 2
  });

  it("BP18-056 Enchanted Sword played from the cemetery: 5 spells there with it count 4", () => {
    expect(merlin(["BP18-056", ...n(4, SPELL7)], 1, { field: [RULENYE] }).stats("BP01-052")).toEqual([4, 3]); // costs 1: not played
    expect(merlin(["BP18-056", ...n(4, SPELL7)], 2, { field: [RULENYE] }).stats("BP01-052")).toEqual([6, 5]);
  });

  it("BP09-075 Gift for Bloodkin played from the cemetery isn't one of the 5 Vampire cards", () => {
    expect(merlin(["BP09-075", ...n(4, "BP06-087")], 1, { field: [RULENYE] }).field()).toEqual(["BP01-052"]); // costs 1: not played
    expect(merlin(["BP09-075", ...n(4, "BP06-087")], 2, { field: [RULENYE] }).field().length).toBe(3); // 2 Forest Bats
  });

  it("BP15-082 Spiteful Screams played from the cemetery: its Necrocharge (10) doesn't count itself (CR 13.5.1.3.1)", () => {
    const galmieux = (pp: number) =>
      d({ me: { field: ["BP05-052"], evolveDeck: ["BP05-053"], cemetery: ["BP15-082", "BP07-081", ...n(8)], evolutionPoints: 1, playPoints: pp }, opp: { field: [RULENYE] } })
        .evolve("BP05-052", { ep: true });
    expect(galmieux(1).field()).toEqual(["BP05-052"]); // costs 1: not played
    expect(galmieux(2).field()).toEqual(["BP05-052", "BP07-081"]);
  });

  it("BP13-052 Arcane Duplication alone in the cemetery has no card to select once played (CR 10.6.2.3.3): Merlin plays nothing", () => {
    const t = merlin(["BP13-052"], 1);
    expect([t.cemetery(), t.zone("me", "banished"), t.decision?.type]).toEqual([["BP13-052"], [], "mainPhase"]);
  });

  it("CP03-061 Skull Juggler with 1 other Pale Moon card in the cemetery: not playable from there", () => {
    const t = merlin(["CP03-061", "CP03-052"], 1);
    expect([t.cemetery(), t.hand(), t.decision?.type]).toEqual([["CP03-061", "CP03-052"], [], "mainPhase"]);
  });

  it("BP11-017 Scavenge: the only Puppetry card in the cemetery is itself, so it isn't playable from there (its ruling Q1)", () => {
    const t = merlin(["BP11-017"], 1);
    expect([t.cemetery(), t.hand(), t.ex(), t.decision?.type]).toEqual([["BP11-017"], [], [], "mainPhase"]);
  });

  it("BP14-011 Craftsman's Pride alone in the EX area can't pay 'banish a card from your EX area' (DSD01a-014 Q2)", () => {
    expect(d({ me: { ex: ["BP14-011"], playPoints: 1 } }).canPlay("BP14-011@ex")).toBe(false);
    const t = d({ me: { ex: ["BP14-011", "V1"], playPoints: 1 } }).play("BP14-011@ex");
    expect([t.zone("me", "banished"), t.ex().length]).toEqual([["V1"], 3]);
  });

  it("BP01-103 Lord Atomy from the EX area: the 4 Abysscraft cards to banish are 4 others (BP01-057 Q3)", () => {
    expect(d({ me: { ex: ["BP01-103", ...n(3, "BP07-078")], playPoints: 0 } }).canPlay("BP01-103@ex")).toBe(false);
    const normal = d({ me: { ex: ["BP01-103", ...n(3, "BP07-078")], playPoints: 9 } }).play("BP01-103@ex");
    expect([normal.field(), normal.zone("me", "banished"), normal.pp()]).toEqual([["BP01-103"], [], 0]);
    const four = d({ me: { ex: ["BP01-103", ...n(4, "BP07-078")], playPoints: 0 } }).play("BP01-103@ex");
    expect([four.field(), four.zone("me", "banished").length]).toEqual([["BP01-103"], 4]);
  });

  it("BP13-T04 Darkest Desire: the cost is determined before it is paid (CR 10.6.2.5), so burying Octrice keeps its discount", () => {
    const t = d({ me: { field: [OCTRICE, "V1"], ex: ["BP13-T04"], playPoints: 0 }, opp: { cemetery: n(10) } }).play("BP13-T04@ex");
    expect([t.field(), t.pp(), t.leader("opp"), t.leader()]).toEqual([[], 0, 18, 22]);
    expect(d({ me: { field: [OCTRICE, "V1"], ex: ["BP13-T04"], playPoints: 2 }, opp: { cemetery: n(10) } }).play("BP13-T04@ex").pp()).toBe(2);
  });

  it("BP13-T04 Darkest Desire: burying a follower the opponent owns doesn't lower the cost already determined", () => {
    // Octrice evolves for 0 (10 cards in the opponent's cemetery) and puts one of them into my EX area (9 left); I play it (no
    // discount at 9); Darkest Desire buries it and one of mine: the opponent's cemetery is 10 again only after the cost (1)
    // was determined.
    const t = d({ me: { field: ["BP05-018", "V1"], evolveDeck: ["BP05-019"], ex: ["BP13-T04"], playPoints: 2 }, opp: { cemetery: n(10) } });
    const dec = t.decision!;
    if (dec.type !== "mainPhase") throw new Error("no main phase");
    const free = dec.actions.find((a) => a.type === "evolve" && a.ability === 1 && !a.useEvolutionPoint && !a.superEvolve)!;
    t.answer({ type: "mainPhase", action: free }).pick("opp:V1");
    t.play("V1@ex");
    expect(t.pp()).toBe(1);
    t.play("BP13-T04@ex");
    const sel = t.decision as { type: string; candidates: CardId[] };
    const theirs = sel.candidates.find((id) => t.game.state.cards[id]!.owner === 1)!;
    const mine = sel.candidates.find((id) => t.game.state.cards[id]!.owner === 0 && t.game.state.cards[id]!.def === "V1")!;
    t.answer({ type: "selectCards", cards: [theirs, mine] });
    expect([t.zone("opp", "cemetery").length, t.pp()]).toEqual([10, 0]);
  });

  it("BP22-039 Pursuer Golem: an Earth Rite (9) that empties an amulet makes room on a full field (CR 13.3.3.2, 10.6.2.6; its Q2)", () => {
    const amulet = (stack: number) => ({ card: "BP01-066", counters: { stack } });
    const full = (field: NonNullable<NonNullable<DriveSpec["me"]>["field"]>) => d({ me: { hand: ["BP22-039"], field, playPoints: 10 } });
    const t = full([amulet(9), "V1", "V1", "V1", "V1"]).play("BP22-039");
    expect([t.field(), t.cemetery(), t.pp()]).toEqual([["V1", "V1", "V1", "V1", "BP22-039"], ["BP01-066"], 9]);
    expect(full([amulet(10), "V1", "V1", "V1", "V1"]).canPlay("BP22-039")).toBe(false); // the amulet would stay
    const two = full([amulet(9), amulet(12), "V1", "V1", "V1"]).play("BP22-039"); // only the one with 9 can pay it
    expect([two.field().length, two.cemetery(), two.counters("BP01-066", "stack")]).toEqual([5, ["BP01-066"], 12]);
  });

  it("the card panel's cost is the one the play pays: Ginger with 10 banished cards (itself too) costs 1", () => {
    const t = d({ me: { ex: [JEWELS], banished: ["BP18-042", ...n(9)], playPoints: 2 } }).play(`${JEWELS}@ex`);
    const g = env(t.game);
    const ginger = t.id("BP18-042@banished");
    expect([playCost(g, ginger, 0), playCostAsPlayed(g, ginger, 0)]).toEqual([0, 1]);
  });
});

describe("withCardInResolution leaves the game as it was", () => {
  it("restores the state exactly, after a check, a check that throws and nested checks, from every zone", () => {
    const t = d({
      me: { hand: ["V1", "KILL", "V3"], ex: ["V2", "V1"], cemetery: ["KILL", "V5"], banished: ["V1", "V3"], playPoints: 5 },
      opp: { cemetery: ["V1", "KILL"], field: ["V5"] },
    });
    const g = env(t.game);
    const before = JSON.stringify(g.state);
    const z = g.state.players;
    const ids = [...z[0].zones.hand, ...z[0].zones.ex, ...z[0].zones.cemetery, ...z[0].zones.banished, ...z[1].zones.cemetery];
    for (const id of ids) {
      const seen = withCardInResolution(g, id, 0, (at) => {
        // Another card checked while this one waits in the resolution zone.
        const other = ids.find((x) => x !== id)!;
        const inner = withCardInResolution(at, other, 0, (at2) => [at2.state.resolution.length, at2.state.cards[other]!.zone] as const);
        return [at.state.cards[id]!.zone, at.state.cards[id]!.controller, at.state.resolution.includes(id), inner] as const;
      });
      expect(seen).toEqual(["resolution", 0, true, [2, "resolution"]]);
      expect(() =>
        withCardInResolution(g, id, 0, () => {
          throw new Error("check failed");
        }),
      ).toThrow("check failed");
      expect(JSON.stringify(g.state)).toBe(before);
    }
  });
});

// For every card whose script changes its own cost, has play options, or a spell's targets or options, put with k copies of
// itself in each zone it can be played from: the check (with the card moved in place) gives the same ways to play it, at the
// same costs, as the same checks on a copy of the game where moveCards really moved it (the move of playCard, 10.6.2.1).
// Also lists the cards whose play the move changes (they count the zone they are played from, or are their own target or
// cost): a new one may be a script reading the card's zone instead of GameReader.playZone, which would never be playable.
const KS = [0, 1, 2, 3, 4, 5, 9, 14];
type Zone = "hand" | "ex" | "cemetery" | "banished" | "evolveDeck" | "oppCemetery";

/**
 * The cards whose play the move to the resolution zone changes here, by the zone they are played from: each counts the cards
 * of that zone, pays with them or selects one, and doesn't count itself once played (BP18-046, BP01-053, DSD01a-014,
 * BP01-057 rulings). Most can be played from the cemetery only by the debug manual play.
 */
const COUNT_THEMSELVES: Record<string, string[]> = {
  banished: ["BP17-051", "BP18-042"],
  cemetery: [
    ...["BP01-057", "BP01-104", "BP02-074", "BP06-035", "BP06-036", "BP06-047", "BP09-075", "BP11-017", "BP12-001", "BP12-038"],
    ...["BP13-052", "BP13-053", "BP13-093", "BP15-082", "BP16-057", "BP18-056", "BP21-053", "CP01-060", "CP03-061", "ECP02-072"],
  ],
  ex: ["BP01-103", "BP14-011"],
};

describe("the play check sees the game the play sees", () => {
  it("every placement: the same ways and costs as after the real move", () => {
    const differences: string[] = [];
    const changed = new Map<string, Set<string>>();
    let placements = 0;
    for (const def of E.db.all()) {
      if (def.type === "leader" || def.type === "crest" || def.type === "equipment" || def.evolved || def.cost === null) continue;
      const script = E.scripts[def.id];
      if (!script) continue;
      const spell = (script.abilities ?? []).find((a) => a.kind === "spell") as SpellAbility | undefined;
      if (!(script.playCost !== undefined || (script.playOptions?.length ?? 0) > 0 || spell?.targets !== undefined || spell?.modes !== undefined)) continue;
      const zones: Zone[] = def.advanced ? ["evolveDeck"] : def.token ? ["ex"] : ["hand", "ex", "cemetery", "banished", "oppCemetery"];
      const options: (PlayOption | null)[] = [null, ...(script.playOptions ?? [])];
      for (const zone of zones) {
        for (const k of KS) {
          if (zone === "ex" && k + 1 > 5) continue; // CR 4.8.3
          const cards = Array<string>(k + 1).fill(def.printings[0]!);
          const game = scenario(E, {
            turn: 5,
            seed: "play-check",
            players: [
              zone === "oppCemetery" ? { field: ["V3"], playPoints: 10, maxPlayPoints: 10 } : { [zone]: cards, field: ["V3"], playPoints: 10, maxPlayPoints: 10 },
              zone === "oppCemetery" ? { field: ["V5", "V1"], cemetery: cards } : { field: ["V5", "V1"] },
            ],
            config: { autoResolve: ["quick"] },
          });
          const g = env(game);
          const list = zone === "oppCemetery" ? g.state.players[1].zones.cemetery : g.state.players[0].zones[zone];
          const card = list.find((id) => g.state.cards[id]!.def === def.id);
          if (card === undefined) continue;
          const ch = specifiable(g, 0, card, "effect");
          if (ch === null) continue;
          placements += 1;
          const ways = (vs: (PlayOption | null)[]) => vs.map((v) => v?.id ?? "normal").join();
          const check = ways(playVariants(g, 0, card, "effect"));
          const costs = options.map((o) => playCostAsPlayed(g, card, 0, o)).join();
          const inPlace = ways(waysInResolution(g, 0, card, ch));
          const inPlaceCosts = options.map((o) => playCost(g, card, 0, o)).join();
          const copy = game.clone();
          const g2 = env(copy);
          const [moved] = moveCards(g2, [{ card, to: "resolution", player: 0, keepEffects: zone === "ex", keepCounters: zone === "ex" }], "play");
          if (moved === undefined) continue;
          const real = ways(waysInResolution(g2, 0, moved, ch));
          const realCosts = options.map((o) => playCost(g2, moved, 0, o)).join();
          if (check !== real || costs !== realCosts) {
            differences.push(`${def.id}@${zone} k=${k}: check [${check}] costs [${costs}] / after the move [${real}] costs [${realCosts}]`);
          }
          if (check !== inPlace || costs !== inPlaceCosts) {
            const at = changed.get(zone) ?? new Set<string>();
            at.add(def.id);
            changed.set(zone, at);
          }
        }
      }
    }
    expect(placements).toBeGreaterThan(10_000);
    expect(differences).toEqual([]);
    const found = Object.fromEntries([...changed].sort(([a], [b]) => a.localeCompare(b)).map(([zone, ids]) => [zone, [...ids].sort()]));
    expect(found).toEqual(COUNT_THEMSELVES);
  }, 600_000);
});
