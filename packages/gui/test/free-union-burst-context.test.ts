import { describe, expect, it, vi } from "vitest";
import { createEngine, type Input, type PlayerId } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower, type DriveSpec } from "@sve/core/testing";
import { Catalog } from "../src/app/catalog";
import { displayAbilityText } from "../src/game/card/ability-display";
import { stateHash } from "../src/engine/game-host";
import { EffectContextObserver } from "../src/presentation/effect-context";

const engine = createEngine({ cards: [...ALL_CARDS, testFollower("PLAIN", 0, 1, 20)], scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((card) => ({ ...card, status: engine.implementationStatus(card.id) })));

function setup(receiver: string, extra: DriveSpec = {}) {
  const def = engine.db.get(receiver);
  const base = def.evolved ? ALL_CARDS.find((c) => c.name === def.name && c.type === "follower" && !c.evolved)!.id : receiver;
  const t = drive(engine, { ...extra,
    me: { universe: "princessConnect", field: ["CP04-113", def.evolved ? { card: base, evolvedInto: receiver } : receiver, "CP04-001"],
      evolveDeck: ["CP04-114"], deck: Array(10).fill("PLAIN"), ...extra.me },
    opp: { field: ["PLAIN", "PLAIN"], ...extra.opp },
    config: { autoResolve: ["quick", "selectPending"], ...extra.config },
  });
  t.game.state.players[0].thisTurn = { ...t.game.state.players[0].thisTurn, turn: t.game.state.turn, unionBursts: 2 };
  const observer = new EffectContextObserver(engine, t.game);
  const delegate = vi.fn((input: Input, from?: PlayerId) => t.game.act(input, from));
  const act = (input: Input) => observer.act(input, undefined, () => delegate(input));
  const context = () => observer.presentation({ perspective: 0, view: t.game.view(0),
    decision: t.decision ? { decision: t.decision, cards: {}, abilities: {} } : null }).effectContext;
  const recipient = t.id(base);
  const start = () => {
    const d = t.decision;
    if (d?.type !== "mainPhase") throw new Error("expected mainPhase");
    const action = d.actions.find((a) => a.type === "evolve" && a.card === t.id("CP04-113"));
    if (!action) throw new Error("missing Ameth evolve action");
    act({ type: "mainPhase", action });
    act({ type: "choose", ids: ["2"] });
    if (t.decision?.type === "selectCards" && t.decision.source === t.id("CP04-113")) act({ type: "selectCards", cards: [recipient] });
  };
  return { t, act, context, recipient, start, delegate };
}

function expectText(h: ReturnType<typeof setup>, def: string, index = 0) {
  expect(h.context()).toMatchObject({ sourceDef: def, abilityIndex: index });
  for (const lang of ["ja", "cn", "en", "zh-Hant"] as const) {
    const expected = ALL_SCRIPTS[def]!.abilities![index]!;
    const text = displayAbilityText(h.context()!, catalog, lang);
    expect(text, `${def}:${index}:${lang}`).not.toBeNull();
    expect(text!.text).toBeTruthy();
    if (index === 0 && expected.kind !== "spell" && expected.unionBurst) expect(text!.text).toMatch(/UB|ub/);
  }
}

describe("free Union Burst target presentation", () => {
  it.each(["CP04-021", "CP04-111"])("shows %s when Ameth's sole eligible recipient is auto-selected", (receiver) => {
    const h = setup(receiver, { me: { field: ["CP04-113", receiver] },
      config: { autoResolve: ["quick", "selectPending", "selectCards", "choose", "orderCards"] } });
    h.start();
    expect(h.t.decision).toMatchObject({ type: "selectCards", reason: "target", source: h.recipient });
    expectText(h, receiver);
    expect(h.delegate).toHaveBeenCalledTimes(2);
  });

  it.each(["CP04-003", "CP04-021", "CP04-061", "CP04-075", "CP04-033", "CP04-094", "CP04-041", "CP04-076", "CP04-117"])(
    "shows %s at its first pre-play target question, without paying its cost", (receiver) => {
      const h = setup(receiver, { me: { cemetery: ["CP04-001"] } });
      h.start();
      expect(h.t.decision).toMatchObject({ type: "selectCards", reason: "target", source: h.recipient });
      expectText(h, receiver);
      expect(h.context()!.modeIds).toBeUndefined();
      expect(h.context()!.pendingId).toBeUndefined();
      expect(h.delegate).toHaveBeenCalledTimes(3);
      if (receiver === "CP04-003") {
        const plain = setup(receiver, { me: { cemetery: ["CP04-001"] } });
        for (const [i, [input]] of h.delegate.mock.calls.entries()) {
          expect(plain.t.game.act(input)).toEqual(h.delegate.mock.results[i]!.value);
        }
        expect(plain.t.decision).toEqual(h.t.decision);
        expect(stateHash(plain.t.game.state)).toBe(stateHash(h.t.game.state));
      }
      const before = h.context();
      const hash = stateHash(h.t.game.state);
      expect(() => h.act({ type: "choose", ids: ["invalid"] })).toThrow();
      expect(h.context()).toEqual(before);
      expect(stateHash(h.t.game.state)).toBe(hash);
    },
  );

  it("keeps CP04-112's instance across distinct-name target selections", () => {
    const h = setup("CP04-112", { me: { cemetery: ["PLAIN", "PLAIN", "CP04-001", "CP04-105"] } });
    h.start();
    expectText(h, "CP04-112");
    const instance = h.context()!.instanceId;
    h.act({ type: "selectCards", cards: [h.t.id("PLAIN@cemetery")] });
    expectText(h, "CP04-112");
    expect(h.context()!.instanceId).toBe(instance);
    const second = h.t.decision;
    expect(second).toMatchObject({ type: "selectCards", reason: "target", source: h.recipient });
    if (second?.type !== "selectCards") throw new Error("expected another target selection");
    expect(second.candidates).not.toContain(h.t.ids("PLAIN@cemetery")[1]);
    h.act({ type: "selectCards", cards: [h.t.id("CP04-001@cemetery")] });
    expectText(h, "CP04-112");
    expect(h.context()!.instanceId).toBe(instance);
    h.act({ type: "selectCards", cards: [] });
  });

  it("keeps CP04-111's instance from target selection through every damage allocation", () => {
    const h = setup("CP04-111", { opp: { field: ["PLAIN", "PLAIN", "PLAIN"] } });
    h.start();
    expectText(h, "CP04-111");
    const instance = h.context()!.instanceId;
    h.act({ type: "selectCards", cards: h.t.ids("opp:PLAIN") });
    for (const amount of ["2", "3"]) {
      expect(h.t.decision).toMatchObject({ type: "choose", reason: "divideDamage", source: h.recipient });
      expectText(h, "CP04-111");
      expect(h.context()!.instanceId).toBe(instance);
      h.act({ type: "choose", ids: [amount] });
    }
    expect(h.t.ids("opp:PLAIN").map((id) => h.t.game.state.cards[id]!.damage)).toEqual([2, 3, 3]);
    expect(h.context()).toBeNull();
  });

  it.each(["CP04-052", "CP04-075"])("hands over to %s's separate UB-triggered automatic ability", (watcher) => {
    const h = setup("CP04-003", { me: { field: ["CP04-113", "CP04-003", watcher], cemetery: ["CP04-118"] } });
    h.start();
    expectText(h, "CP04-003");
    const inner = h.context()!.instanceId;
    h.act({ type: "selectCards", cards: [h.t.id(watcher)] });
    const d = h.t.decision;
    const pending = h.t.game.state.pending.find((p) => p.sourceDef === watcher && p.ability === 1);
    if (d?.type === "selectPending") {
      expect(d.options).toContain(pending!.id);
      h.act({ type: "selectPending", id: pending!.id });
    }
    expectText(h, watcher, 1);
    expect(h.context()!.instanceId).not.toBe(inner);
    expect(h.context()!.pendingId).toBeTruthy();
    expect(displayAbilityText(h.context()!, catalog, "en")!.text).toContain(watcher === "CP04-052" ? "PriConne spell" : "chosen this turn");
    expect(h.t.decision).toMatchObject(watcher === "CP04-052"
      ? { type: "selectCards", reason: "target", source: h.t.id(watcher) }
      : { type: "choose", reason: "mode", source: h.t.id(watcher) });
  });

  it.each(["CP04-052", "CP04-075"])("distinguishes %s's UB and its own reaction to Ameth", (receiver) => {
    const h = setup(receiver, { me: { cemetery: ["CP04-118"] } });
    h.start();
    expectText(h, receiver);
    const instance = h.context()!.instanceId;
    h.act({ type: "selectCards", cards: [h.t.id("opp:PLAIN")] });
    expectText(h, receiver, 1);
    expect(h.context()!.instanceId).not.toBe(instance);
  });

  it("shows the reaction instead when CP04-052's free UB has no legal target", () => {
    const h = setup("CP04-052", { me: { cemetery: ["CP04-118"] }, opp: { field: [] } });
    h.start();
    expect(h.t.decision).toMatchObject({ type: "selectCards", reason: "target", source: h.recipient });
    expectText(h, "CP04-052", 1);
  });
});
