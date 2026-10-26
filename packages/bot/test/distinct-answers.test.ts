import { describe, expect, it } from "vitest";
import { createEngine, script, seedRng, validateAnswer, type Answer, type Decision, type GameSession } from "../src/core";
import { candidateAnswers } from "../src/candidates";
import { planBranches } from "../src/branches";
import { answerSigner, choiceKey, distinctSelections, selectionKey, type SameCard } from "../src/distinct-answers";
import { cardSignatures, positionKey } from "../src/keys";
import { searchSureLethal } from "../src/lethal";
import { lookupFromReader } from "../src/policy";
import { drive, testFollower, testSpell, type DriveSpec } from "../../core/src/testing";

// Selections and choices told apart by what they choose (PlannerBotOptions.choiceDedupe, distinct-answers.ts).

const { defineCard, spell } = script;
const FOLLOWERS = ["F1", "F2", "F3", "F4", "F5", "F6"];
const cards = createEngine({
  cards: [
    ...FOLLOWERS.map((id, i) => testFollower(id, 1 + i, 1 + i, 1 + i)),
    testFollower("A", 2, 2, 2),
    testFollower("B", 3, 3, 3),
    testFollower("FILLER", 1, 1, 1),
    testFollower("BIG", 2, 5, 5),
    testFollower("WALL", 2, 1, 3),
    testSpell("SEEK", 1, { text: "Search your deck for a follower and put it into your hand." }),
    testSpell("PICK2", 1, { text: "Select up to 2 enemy followers. Destroy them." }),
  ],
  scripts: {
    WALL: defineCard({ keywords: ["ward"] }),
    SEEK: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            yield* fx.search((id) => fx.game.info(id).type === "follower", { max: 1 });
          },
        }),
      ],
    }),
    PICK2: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            const chosen = yield* fx.selectCards(fx.game.followers(fx.game.opponent(fx.controller)), 0, 2);
            if (chosen.length > 0) yield* fx.destroy(chosen);
          },
        }),
      ],
    }),
  },
});
const many = (n: number, id: string) => Array<string>(n).fill(id);

/** The game at the selection the spell in hand asks for (the spell played from our main phase). */
function selectionOf(spec: DriveSpec, spell: string): { game: GameSession; d: Extract<Decision, { type: "selectCards" }> } {
  const t = drive(cards, { ...spec, config: { autoResolve: ["quick", "selectPending", "orderCards"] } });
  const game = t.game;
  const d0 = game.decision!;
  if (d0.type !== "mainPhase") throw new Error("not at a main phase");
  const play = d0.actions.find((a) => a.type === "play" && game.reader().card(a.card)?.def === spell)!;
  game.act({ type: "mainPhase", action: play });
  const d = game.decision!;
  if (d.type !== "selectCards") throw new Error(`no selection: ${d.type}`);
  return { game, d };
}

/** The answers' selections by what they select (signature multisets). */
const selected = (answers: Answer[], same: SameCard) => answers.map((a) => (a.type === "selectCards" ? selectionKey(a.cards, same) : "?"));

describe("distinct answers", () => {
  it("a search of 15 cards of 6 kinds, at most 1: the 6 different cards and none, all of them (no samples drawn)", () => {
    // 15 followers of 6 definitions in the deck (and the spell's own deck around them).
    const deck = [...FOLLOWERS, ...FOLLOWERS, "F1", "F2", "F3"];
    const { game, d } = selectionOf({ me: { hand: ["SEEK"], deck, playPoints: 3, maxPlayPoints: 3 }, opp: { deck: many(10, "FILLER") } }, "SEEK");
    expect(d.candidates).toHaveLength(15);
    const same = answerSigner(game.view(d.player), d);
    const rng = seedRng("t");
    const before = JSON.stringify(rng);
    const answers = candidateAnswers(d, lookupFromReader(game.reader()), rng, 16, false, same);
    expect(answers).toHaveLength(7);
    expect(new Set(selected(answers, same)).size).toBe(7);
    expect(answers.map((a) => (a.type === "selectCards" ? a.cards.length : -1)).sort()).toEqual([0, 1, 1, 1, 1, 1, 1]);
    // Every one listed: no sample drawn.
    expect(JSON.stringify(rng)).toBe(before);
    for (const a of answers) expect(validateAnswer(d, a)).toBeNull();
    // Without the signatures: the first 10 ids listed, then samples (another copy of a card listed is another answer).
    const plain = candidateAnswers(d, lookupFromReader(game.reader()), seedRng("t"), 16);
    expect(plain.length).toBeGreaterThan(7);
  });

  it("up to 2 of four followers that are two pairs of identical ones: exactly 6 ({}, {A}, {B}, {A,A}, {A,B}, {B,B})", () => {
    const { game, d } = selectionOf({ me: { hand: ["PICK2"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 }, opp: { field: ["A", "A", "B", "B"], deck: many(10, "FILLER") } }, "PICK2");
    const same = answerSigner(game.view(d.player), d);
    const all = distinctSelections(d, same, 100);
    expect(all.complete).toBe(true);
    const defs = (a: Answer) => (a.type === "selectCards" ? a.cards.map((id) => game.reader().card(id)!.def).sort().join("") : "?");
    expect(all.answers.map(defs)).toEqual(["", "A", "B", "AA", "AB", "BB"]);
    const answers = candidateAnswers(d, lookupFromReader(game.reader()), seedRng("t"), 16, false, same);
    expect(answers.map(defs).sort()).toEqual(["", "A", "AA", "AB", "B", "BB"]);
    for (const a of answers) expect(validateAnswer(d, a)).toBeNull();
  });

  it("the same card damaged or engaged is another card", () => {
    const { game, d } = selectionOf(
      { me: { hand: ["PICK2"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 }, opp: { field: ["A", { card: "A", damage: 1 }, { card: "A", engaged: true }, "A"], deck: many(10, "FILLER") } },
      "PICK2",
    );
    const same = answerSigner(game.view(d.player), d);
    expect(new Set(d.candidates.map(same)).size).toBe(3);
    // Sizes 0..2 over the groups of 2, 1 and 1 cards: 1 + 3 + 4 multisets.
    expect(distinctSelections(d, same, 100).answers).toHaveLength(8);
  });

  it("samples drawn among many never list one selection twice (another order, another copy)", () => {
    const field = ["A", "A", "B", "B", "BIG", "WALL", "F1", "F2"];
    const { game, d } = selectionOf({ me: { hand: ["PICK2"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 }, opp: { field, deck: many(10, "FILLER") } }, "PICK2");
    const same = answerSigner(game.view(d.player), d);
    for (const seed of ["a", "b", "c", "d"]) {
      const answers = candidateAnswers(d, lookupFromReader(game.reader()), seedRng(seed), 16, false, same);
      const keys = selected(answers, same);
      expect(new Set(keys).size).toBe(keys.length);
      for (const a of answers) expect(validateAnswer(d, a)).toBeNull();
    }
  });

  it("a forced candidate is never merged with a free one of the same card, and every selection includes it as far as it can", () => {
    const d: Extract<Decision, { type: "selectCards" }> = { type: "selectCards", player: 0, reason: "effect", candidates: ["c1", "c2", "c3"], candidateDefs: ["A", "A", "B"], min: 0, max: 2, source: null, mandatory: ["c1"] };
    const same: SameCard = (id) => (id === "c1" ? "!A" : id === "c2" ? "A" : "B");
    const all = distinctSelections(d, same, 100);
    expect(all.answers.map((a) => (a.type === "selectCards" ? a.cards.join(",") : ""))).toEqual(["", "c1", "c1,c2", "c1,c3"]);
    for (const a of all.answers) expect(validateAnswer(d, a)).toBeNull();
  });

  it("choices as sets: the samples never list the same options twice", () => {
    const d: Decision = { type: "choose", player: 0, reason: "mode", options: ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, label: id })), min: 0, max: 3, source: null };
    const answers = candidateAnswers(d, () => undefined, seedRng("x"), 16, false, () => "");
    const keys = answers.map((a) => (a.type === "choose" ? choiceKey(a.ids) : ""));
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of answers) expect(validateAnswer(d, a)).toBeNull();
  });

  it("reads what the player sees only: the real game and a sample of it give the same signatures and answers", () => {
    const { game, d } = selectionOf({ me: { hand: ["PICK2", "BIG", "F3"], deck: [...FOLLOWERS, ...FOLLOWERS], playPoints: 3, maxPlayPoints: 3 }, opp: { hand: ["F1", "F6", "WALL"], field: ["A", "A", "B"], deck: [...FOLLOWERS, "BIG", "WALL"] } }, "PICK2");
    const sample = game.determinized(0, "other cards");
    const ds = sample.decision!;
    expect(JSON.stringify(ds)).toBe(JSON.stringify(d));
    const real = answerSigner(game.view(0), d);
    const fake = answerSigner(sample.view(0), ds);
    expect(d.candidates.map(fake)).toEqual(d.candidates.map(real));
    const a = planBranches(d, lookupFromReader(game.reader()), seedRng("s"), 16, real);
    const b = planBranches(ds, lookupFromReader(sample.reader()), seedRng("s"), 16, fake);
    expect(b).toEqual(a);
  });

  it("cardSignatures leaves positionKey as it is and tells a card's place and state, not its id", () => {
    const t = drive(cards, { me: { hand: ["A", "A"], field: ["B", "B", { card: "B", damage: 1 }], deck: many(5, "FILLER") }, opp: { field: ["A"], hand: ["B", "B"], deck: many(5, "FILLER") } });
    const view = t.game.view(0);
    const key = positionKey(view);
    const sig = cardSignatures(view);
    expect(positionKey(view)).toBe(key);
    const field = view.players[0].field.map((c) => sig(c.id)!.signature);
    expect(new Set(field).size).toBe(2);
    const hand = view.players[0].hand.map((c) => sig(c.id)!.signature);
    expect(hand[0]).toBe(hand[1]);
    const theirs = view.players[1].hand.map((c) => sig(c.id)!);
    expect(theirs.every((s) => s.hidden)).toBe(true);
    expect(theirs[0]!.signature).toBe(theirs[1]!.signature);
  });

  it("main phase: an attack on either of two identical enemy followers is tried once", () => {
    // Engaged enemy followers can be attacked (CR 8.4.3).
    const engaged = (card: string) => ({ card, engaged: true });
    const t = drive(cards, { me: { field: ["BIG", "BIG"], deck: many(5, "FILLER") }, opp: { field: [engaged("A"), engaged("A"), engaged("B")], deck: many(5, "FILLER") } });
    const d = t.game.decision!;
    const lookup = lookupFromReader(t.game.reader());
    const same = answerSigner(t.game.view(0), d);
    const plain = planBranches(d, lookup, seedRng("m"), 64);
    const distinct = planBranches(d, lookup, seedRng("m"), 64, same);
    const attacks = (xs: Answer[]) => xs.filter((a) => a.type === "mainPhase" && a.action.type === "attack").length;
    // Two identical attackers already count once; their targets: the leader, A, A, B -> 4 without, 3 with the signatures.
    expect(attacks(plain)).toBe(4);
    expect(attacks(distinct)).toBe(3);
  });

  it("a sure lethal through two identical Wards: found either way, with no more answers tried", () => {
    // Three 5/5 attackers, two identical engaged 1/3 Wards in the way (CR 12.8.2), the leader at 5.
    const wall = { card: "WALL", engaged: true };
    const t = drive(cards, { me: { field: ["BIG", "BIG", "BIG"], deck: many(5, "FILLER") }, opp: { field: [wall, wall], leaderDefense: 5, deck: many(5, "FILLER") } });
    const search = (dedupe: boolean) =>
      searchSureLethal(0, {
        budget: 800,
        beam: 16,
        maxBranches: 16,
        world: () => t.game.clone(),
        checks: 0,
        searchResponder: () => null,
        checkResponder: () => null,
        maxLines: 6,
        seed: "w",
        ...(dedupe ? { dedupe: true } : {}),
      });
    const plain = search(false);
    const distinct = search(true);
    expect(plain.line).not.toBeNull();
    expect(distinct.line).not.toBeNull();
    expect(distinct.line).toHaveLength(plain.line!.length);
    // (4 answers tried against 3: the attack on the other Ward isn't tried again.)
    expect(distinct.simulations).toBeLessThan(plain.simulations);
  });
});
