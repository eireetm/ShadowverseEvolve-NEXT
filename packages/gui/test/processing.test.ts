import { createEngine, type Input, type MainAction } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower, type DriveSpec } from "@sve/core/testing";
import { describe, expect, it } from "vitest";
import { ProcessingTracker } from "../src/engine/processing";

// What a decision is part of — a card or ability being played (CR 10.6.2) — as the engine worker works it out from the answers,
// the events and the resolution zone, without the core saying it (engine/processing.ts).

const engine = createEngine({ cards: [...ALL_CARDS, testFollower("V1", 1, 1, 1), testFollower("V2", 2, 2, 2)], scripts: ALL_SCRIPTS });

/** A game answered input by input as the engine worker does, the tracker following it. */
function follow(spec: DriveSpec) {
  // The core plays the only pending ability itself, as in the app's games.
  const t = drive(engine, { ...spec, config: { autoResolve: ["selectPending"], ...spec.config } });
  const tracker = new ProcessingTracker();
  const act = (input: Input) => {
    tracker.beforeInput(t.game, input);
    const events = t.game.act(input);
    tracker.afterInput(t.game, events);
    return events;
  };
  const main = (pick: (a: MainAction) => boolean) => {
    const d = t.game.decision;
    if (d?.type !== "mainPhase") throw new Error(`expected a main phase decision, got ${d?.type}`);
    const action = d.actions.find(pick);
    if (!action) throw new Error("no such action");
    return act({ type: "mainPhase", action });
  };
  const now = () => tracker.current(t.game, t.game.decision!);
  return { t, act, main, now };
}

describe("what a decision is part of", () => {
  it("a Fanfare the core plays itself (the only pending one): its target is asked as part of it", () => {
    const { t, act, main, now } = follow({ me: { hand: ["BP01-012"], playPoints: 5 }, opp: { field: ["V1", "V2"] } });
    main((a) => a.type === "play" && a.card === t.id("BP01-012"));
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "target" });
    expect(now()).toMatchObject({ kind: "ability", sourceDef: "BP01-012", ability: 0, source: t.id("BP01-012@field") });
    act({ type: "selectCards", cards: [t.id("opp:V2")] });
    expect(t.decision?.type).toBe("mainPhase");
    expect(now()).toBeNull();
  });

  it("an activated ability: its definition's ability, though the action names it by its card's abilities", () => {
    const { t, act, main, now } = follow({ me: { field: ["BP15-001"] }, opp: { field: ["V1", "V2"] } });
    main((a) => a.type === "activate" && a.card === t.id("BP15-001"));
    expect(now()).toMatchObject({ kind: "ability", sourceDef: "BP15-001", ability: 1 });
    act({ type: "selectCards", cards: [t.id("opp:V2")] });
    expect(now()).toBeNull();
  });

  it("a spell being played: how it is played, then its target with the way it was chosen", () => {
    const { t, act, main, now } = follow({ me: { hand: ["BP13-060"], playPoints: 10 }, opp: { field: ["V1", "V2"] } });
    main((a) => a.type === "play" && a.card === t.id("BP13-060"));
    expect(t.decision).toMatchObject({ type: "choose", reason: "playOption" });
    const played = t.id("BP13-060@resolution");
    expect(now()).toEqual({ kind: "card", controller: 0, source: played, sourceDef: "BP13-060" });
    act({ type: "choose", ids: ["plus3"] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "target" });
    expect(now()).toEqual({ kind: "card", controller: 0, source: played, sourceDef: "BP13-060", playOption: { id: "plus3", label: "Play for 3 more play points" } });
  });

  it("two pending abilities: the one chosen, then the other one the core plays itself", () => {
    // BP01-018 deals 1 damage whenever another follower is put onto its field; BP01-012's Fanfare deals 1 damage too.
    const { t, act, main, now } = follow({ me: { field: ["BP01-018"], hand: ["BP01-012"], playPoints: 5 }, opp: { field: ["V2", "V2"] } });
    main((a) => a.type === "play" && a.card === t.id("BP01-012"));
    const pending = t.decision;
    expect(pending?.type).toBe("selectPending");
    expect(now()).toBeNull();
    const archer = t.game.state.pending.find((p) => p.sourceDef === "BP01-018")!;
    act({ type: "selectPending", id: archer.id });
    expect(now()).toMatchObject({ kind: "ability", sourceDef: "BP01-018", ability: 1, source: t.id("BP01-018") });
    const [first, second] = t.ids("opp:V2");
    act({ type: "selectCards", cards: [first!] });
    // The Fanfare left is the only one: the core plays it, and asks its target.
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "target" });
    expect(now()).toMatchObject({ kind: "ability", sourceDef: "BP01-012", ability: 0 });
    act({ type: "selectCards", cards: [second!] });
    expect(now()).toBeNull();
  });

  it("nothing for a rules process (the hand limit), even right after an ability", () => {
    const { t, act, main, now } = follow({ me: { hand: ["BP01-012", ...Array(8).fill("V1")], playPoints: 5 }, opp: { field: ["V1", "V2"] } });
    main((a) => a.type === "play" && a.card === t.id("BP01-012"));
    act({ type: "selectCards", cards: [t.id("opp:V2")] });
    main((a) => a.type === "endMainPhase");
    while (t.decision && t.decision.type !== "selectCards") act(t.decision.type === "quick" ? { type: "quick", action: { type: "pass" } } : { type: "confirm", yes: false });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "handLimitDiscard" });
    expect(now()).toBeNull();
  });
});
