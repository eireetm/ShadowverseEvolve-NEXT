import { describe, expect, it } from "vitest";
import { createEngine, script, type Answer, type GameSession } from "../src/core";
import { PlannerBot } from "../src";
import { attacksOf, keepsMoreCards, lineKey, lineSlots, LINE_SLOT_DEFAULTS, type LineNode } from "../src/plan-lines";
import { drive, testFollower, testSpell } from "../../core/src/testing";

// The comparison's slots by distinct lines (PlannerBotOptions.lineSlots) and its tie-break (tieKeepHand): plan-lines.ts.

const { defineCard, spell } = script;
const cards = createEngine({
  cards: [
    testFollower("A", 1, 1, 1),
    testFollower("B", 1, 2, 2),
    testFollower("FILLER", 1, 1, 1),
    testFollower("BIG", 2, 5, 5),
    testSpell("SEEK", 0, { text: "Search your deck for a follower and put it into your hand." }),
    testSpell("PICK1", 0, { text: "Select an enemy follower. Destroy it." }),
  ],
  scripts: {
    SEEK: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            yield* fx.search((id) => fx.game.info(id).type === "follower", { max: 1 });
          },
        }),
      ],
    }),
    PICK1: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            const [target] = yield* fx.selectCards(fx.game.followers(fx.game.opponent(fx.controller)), 1, 1);
            if (target !== undefined) yield* fx.destroy([target]);
          },
        }),
      ],
    }),
  },
});
const many = (n: number, id: string) => Array<string>(n).fill(id);

/** A fake plan point: only its answer, parent and rank (lineSlots with its own keys, attacksOf). */
function fake(parent: LineNode | null, answer: Answer | null, value = 0): LineNode {
  return { session: null as unknown as GameSession, parent, answer, value };
}
const attack: Answer = { type: "mainPhase", action: { type: "attack", attacker: "c1", target: "c2" } };
const play: Answer = { type: "mainPhase", action: { type: "play", card: "c3" } };

/**
 * A plan played in a copy of `game` (answers matched by what they are at each step: an answer a function of the decision),
 * as the planner's nodes keep it: each point's game is its own copy.
 */
function planOf(game: GameSession, steps: ((s: GameSession) => Answer)[], value = 0): LineNode {
  let node: LineNode = { session: game.clone(), parent: null, answer: null, value };
  const given: Answer[] = [];
  for (const step of steps) {
    const s = game.clone();
    for (const a of given) s.act(a);
    const answer = step(s);
    s.act(answer);
    given.push(answer);
    node = { session: s, parent: node, answer, value };
  }
  return node;
}
const playCard = (def: string) => (s: GameSession): Answer => {
  const d = s.decision!;
  if (d.type !== "mainPhase") throw new Error(`not a main phase: ${d.type}`);
  const action = d.actions.find((a) => a.type === "play" && s.reader().card(a.card)?.def === def);
  if (!action) throw new Error(`no play of ${def}`);
  return { type: "mainPhase", action };
};
const select = (def: string) => (s: GameSession): Answer => {
  const d = s.decision!;
  if (d.type !== "selectCards") throw new Error(`not a selection: ${d.type}`);
  const id = d.candidates.find((c, i) => (d.candidateDefs[i] ?? s.reader().card(c)?.def) === def);
  if (!id) throw new Error(`no candidate ${def}`);
  return { type: "selectCards", cards: [id] };
};
const attackLeader = (def: string) => (s: GameSession): Answer => {
  const d = s.decision!;
  if (d.type !== "mainPhase") throw new Error(`not a main phase: ${d.type}`);
  const action = d.actions.find((a) => a.type === "attack" && s.reader().card(a.attacker)?.def === def && s.reader().card(a.target)?.zone === "leader");
  if (!action) throw new Error(`no attack of ${def}`);
  return { type: "mainPhase", action };
};

describe("plan lines", () => {
  it("a line: the cards played and the attacks, not the own card searched; in any order (set) or as played (seq)", () => {
    const t = drive(cards, {
      me: { hand: ["SEEK", "PICK1"], field: ["BIG"], deck: ["A", "B", "A", "B", ...many(6, "FILLER")], playPoints: 2, maxPlayPoints: 2 },
      opp: { field: ["A", "B"], deck: many(10, "FILLER") },
      config: { autoResolve: ["quick", "selectPending", "orderCards"] },
    });
    const g = t.game;
    const seekA = planOf(g, [playCard("SEEK"), select("A"), attackLeader("BIG")]);
    const seekB = planOf(g, [playCard("SEEK"), select("B"), attackLeader("BIG")]);
    const attackFirst = planOf(g, [attackLeader("BIG"), playCard("SEEK"), select("A")]);
    expect(lineKey(seekA, "set")).toBe(lineKey(seekB, "set"));
    expect(lineKey(attackFirst, "set")).toBe(lineKey(seekA, "set"));
    expect(lineKey(attackFirst, "seq")).not.toBe(lineKey(seekA, "seq"));
    // The enemy follower destroyed is part of the line (a target of the opponent's is a choice that matters).
    const killA = planOf(g, [playCard("PICK1"), select("A")]);
    const killB = planOf(g, [playCard("PICK1"), select("B")]);
    expect(lineKey(killA, "set")).not.toBe(lineKey(killB, "set"));
    expect(attacksOf(seekA)).toBe(1);
    expect(attacksOf(killA)).toBe(0);
  });

  it("slots: plans of one line take one slot; the best 3 lines, one attacking less within the margin, as many as the slots", () => {
    const root = fake(null, null);
    const line = (key: string, value: number, attacks: number) => {
      let n = root;
      for (let i = 0; i < attacks; i++) n = fake(n, attack, value);
      const end = fake(n, play, value);
      keys.set(end, key);
      return end;
    };
    const keys = new Map<LineNode, string>();
    // Best first, as the beam returns them: line X three times (another card searched), then lines Y, Z, W, V.
    const finished = [line("X", 10, 2), line("X", 9.9, 2), line("X", 9.8, 2), line("Y", 9, 2), line("Z", 8, 2), line("W", 7.5, 1), line("V", 7, 0)];
    const keyOf = (n: LineNode) => keys.get(n)!;
    const out = lineSlots(finished, 4, LINE_SLOT_DEFAULTS, keyOf);
    expect(out.map(keyOf)).toEqual(["X", "Y", "Z", "V"]);
    expect(out[0]).toBe(finished[0]);
    // Beyond the margin (the fewest attacks 3.1 points down): the fourth line instead.
    const out2 = lineSlots(finished, 4, { ...LINE_SLOT_DEFAULTS, margin: 2.4 }, keyOf);
    expect(out2.map(keyOf)).toEqual(["X", "Y", "Z", "W"]);
    // Fewer lines than slots: the best plans left fill them; never more than the slots.
    const few = finished.slice(0, 4);
    expect(lineSlots(few, 4, LINE_SLOT_DEFAULTS, keyOf)).toEqual([finished[0], finished[3], finished[1], finished[2]]);
    expect(lineSlots(finished, 2, LINE_SLOT_DEFAULTS, keyOf)).toHaveLength(2);
  });

  it("the tie-break: within eps the plan keeping more cards, then the higher value, then the first", () => {
    const hands = [2, 3, 3, 1];
    expect(keepsMoreCards([5, 5, 5, 5], 0, 0.01, (i) => hands[i]!)).toBe(1);
    expect(keepsMoreCards([5, 4.995, 5.004, 5], 2, 0.01, (i) => hands[i]!)).toBe(2);
    expect(keepsMoreCards([5, 4.98, 5, 5], 0, 0.01, (i) => hands[i]!)).toBe(2);
    expect(keepsMoreCards([5.02, 5, 5, 5], 0, 0.01, (i) => hands[i]!)).toBe(0);
    expect(keepsMoreCards([5, 5, 5, 5], 0, 0, (i) => hands[i]!)).toBe(0);
  });

  it("the planner's pick: a tie goes to the plan keeping more cards; a turn that explores draws as without it", () => {
    const t = drive(cards, { me: { hand: ["A", "B"], deck: many(10, "FILLER"), playPoints: 2, maxPlayPoints: 2 }, opp: { deck: many(10, "FILLER") } });
    const g = t.game;
    const root: LineNode = { session: g.clone(), parent: null, answer: null, value: 0 };
    const played = planOf(g, [playCard("A")]);
    const kept: LineNode = { session: g.clone(), parent: root, answer: play, value: 0 };
    const playedHere: LineNode = { ...played, parent: root };
    const turn = g.state.turn;
    type Pick = { pick(c: LineNode[], v: number[], turn: number): LineNode };
    const bot = (o: object) => new PlannerBot(cards, { seed: "p", ...o }) as unknown as Pick;
    expect(bot({}).pick([playedHere, kept], [5, 5], turn)).toBe(playedHere);
    expect(bot({ tieKeepHand: 0.01 }).pick([playedHere, kept], [5, 5], turn)).toBe(kept);
    expect(bot({ tieKeepHand: 0.01 }).pick([playedHere, kept], [5.02, 5], turn)).toBe(playedHere);
    for (const seed of ["e1", "e2", "e3", "e4", "e5", "e6"]) {
      const explore = { explore: { rate: 1, temperature: 1 }, seed };
      const a = (new PlannerBot(cards, explore) as unknown as Pick).pick([playedHere, kept], [5, 5], turn);
      const b = (new PlannerBot(cards, { ...explore, tieKeepHand: 0.01 }) as unknown as Pick).pick([playedHere, kept], [5, 5], turn);
      expect(b).toBe(a);
    }
  });
});
