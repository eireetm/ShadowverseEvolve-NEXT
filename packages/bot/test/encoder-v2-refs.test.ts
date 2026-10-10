import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine, type CardView, type DefId, type PlayerId } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { scenario, type FieldCardSpec } from "../../core/src/testing/scenario";
import { cardFeatureTable, type CardFeatureFile, type CardFeatureTable, type CardRef, type KnownDeck } from "../src";
import {
  binom,
  cardToken,
  e16,
  emptyDiagnosticsV2,
  evolveRefColumns,
  odds,
  REL_COLUMNS_V2,
  refDomain,
  relColumns,
  round1000,
  type EncodeDiagnosticsV2,
  type RefTrace,
  type TokenZone,
} from "../src/encoder-v2-refs";

// Encoder v2's counting of what a card counts: exact arithmetic, where a reference is counted (a played card leaves its zone
// and enters the field, a dying one goes to the cemetery, an evolving one becomes its evolve card), which references are
// live where the card is, the comparison's direction and role, choice groups, and the opponent's hidden cards as a draw.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const table = cardFeatureTable(JSON.parse(readFileSync(join(__dirname, "..", "src", "card-features.json"), "utf8")) as CardFeatureFile);
const printing = (def: DefId) => engine.db.get(def).printings[0]!;

interface Side {
  deck?: DefId[];
  hand?: DefId[];
  field?: (DefId | (Omit<FieldCardSpec, "card"> & { card: DefId }))[];
  ex?: DefId[];
  cemetery?: DefId[];
  banished?: DefId[];
  evolveDeck?: DefId[];
}

/** A list of the side's cards (its main list: every non-token card it has placed; its evolve list). */
function listOf(s: Side): KnownDeck {
  const main = new Map<DefId, number>();
  const evolve = new Map<DefId, number>();
  const add = (m: Map<DefId, number>, d: DefId) => {
    if (!engine.db.get(d).token) m.set(d, (m.get(d) ?? 0) + 1);
  };
  for (const d of [...(s.deck ?? []), ...(s.hand ?? []), ...(s.ex ?? []), ...(s.cemetery ?? []), ...(s.banished ?? [])]) add(main, d);
  for (const f of s.field ?? []) add(main, typeof f === "string" ? f : f.card);
  for (const d of s.evolveDeck ?? []) add(evolve, d);
  return { main, evolve };
}

/** A position (seat 0 is the viewer, in its main phase), its counting domain, and a token's REL columns. */
function position(me: Side, opp: Side, options: { table?: CardFeatureTable; remember?: (game: ReturnType<typeof scenario>) => void; lists?: [KnownDeck, KnownDeck] } = {}) {
  const tbl = options.table ?? table;
  const spec = (s: Side) => ({
    deck: s.deck?.map(printing),
    hand: s.hand?.map(printing),
    field: s.field?.map((f) => (typeof f === "string" ? printing(f) : { ...f, card: printing(f.card), equipped: f.equipped?.map(printing) })),
    ex: s.ex?.map(printing),
    cemetery: s.cemetery?.map(printing),
    banished: s.banished?.map(printing),
    evolveDeck: s.evolveDeck?.map(printing),
  });
  const game = scenario(engine, { players: [spec(me), spec(opp)] });
  options.remember?.(game);
  const view = game.view(0);
  const diag = emptyDiagnosticsV2();
  const dom = refDomain(view, 0, tbl, options.lists ?? [listOf(me), listOf(opp)], diag);
  const token = (zone: TokenZone, side: PlayerId, def: DefId, nth = 0) => {
    const zoneCards = view.players[side][zone] as readonly (CardView | { hidden: true })[];
    const c = zoneCards.filter((x): x is CardView => !x.hidden && x.def === def)[nth];
    if (!c) throw new Error(`no ${def} in ${zone} of ${side}`);
    return cardToken(dom, zone, side, c);
  };
  const rel = (zone: TokenZone, side: PlayerId, def: DefId) => {
    const out = new Array<number>(REL_COLUMNS_V2.length).fill(0);
    const traces: RefTrace[] = [];
    relColumns(dom, token(zone, side, def), out, 0, diag, traces);
    const at = (name: string) => out[REL_COLUMNS_V2.indexOf(name)]!;
    return Object.assign(at, { traces, out });
  };
  return { game, view, dom, diag, token, rel };
}

const quiet = (d: EncodeDiagnosticsV2) => expect({ ...d, refZoneOther: 0, oppAlt: 0, knownNotInList: 0 }).toEqual(emptyDiagnosticsV2());
/** A table with some definitions' references replaced (a reference the pool doesn't have, for a case to test). */
const withRefs = (extra: Record<DefId, CardRef[]>): CardFeatureTable => ({ ...table, refsOf: (d) => extra[d] ?? table.refsOf(d) });
const ref = (r: Partial<CardRef>): CardRef => ({ timing: "continuous", ability: -1, key: "field", where: "condition", zones: ["field"], side: "own", filter: { t: "any" }, agg: "count", threshold: null, scaled: false, test: null, from: ["field"], ...r });
// Vanilla followers of the pool (no references), for hands, decks and fields that count nothing themselves.
const vanilla = engine.db
  .all()
  .filter((d) => d.type === "follower" && !d.token && !d.evolved && d.cost !== null && d.cost <= 3 && !table.file.refs[d.id] && d.class === "Neutral")
  .map((d) => d.id)
  .sort();
const [A, B, X] = vanilla as [DefId, DefId, DefId];

describe("exact arithmetic", () => {
  // An independent count of C(n, k) (the multiplicative formula) and a rational test of the rounding.
  const choose = (n: number, k: number): bigint => {
    if (k < 0 || k > n) return 0n;
    let r = 1n;
    for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
    return r;
  };
  it("gives the hypergeometric probability exactly, half-up to thousandths, within 1–999 unless determined", () => {
    let checked = 0;
    for (let N = 1; N <= 50; N += 7) {
      for (let n = 0; n <= N; n += 3) {
        for (let K = 0; K <= N; K += 5) {
          for (const t of [
            { kind: "atLeast", n: 1 },
            { kind: "atLeast", n: 2 },
            { kind: "atMost", n: 0 },
            { kind: "exactly", n: 1 },
          ] as const) {
            const o = odds(N, K, n, 0, t);
            const lo = Math.max(0, n - (N - K));
            const hi = Math.min(K, n);
            const ok = (x: number) => (t.kind === "atLeast" ? x >= t.n : t.kind === "atMost" ? x <= t.n : x === t.n);
            let num = 0n;
            for (let x = lo; x <= hi; x++) if (ok(x)) num += choose(K, x) * choose(N - K, n - x);
            const den = choose(N, n);
            const determined = [...Array(hi - lo + 1).keys()].every((i) => ok(lo + i) === ok(lo));
            expect(o.determined, `${N},${K},${n} ${t.kind}${t.n}`).toBe(determined);
            if (determined) expect(o.p).toBe(ok(lo) ? 1000 : 0);
            else {
              // Half-up: the nearest thousandth, .5 up; then kept within 1–999.
              const exact = Number(((num * 2000n + den) / (2n * den)).toString());
              expect(o.p).toBe(Math.min(999, Math.max(1, exact)));
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(binom(10, 3)).toBe(120n);
    expect([round1000(1n, 2000n), round1000(1n, 3n), round1000(2n, 3n), round1000(1n, 2n)]).toEqual([1, 333, 667, 500]);
    // Need 1, none certain, 3 hidden among 10 unseen of which 8 match: at least one is certain.
    expect(odds(10, 8, 3, 0, { kind: "atLeast", n: 1 })).toMatchObject({ determined: true, value: true, p: 1000 });
    // A near-certain but not determined test stays at 999.
    expect(odds(50, 40, 10, 0, { kind: "atLeast", n: 2 })).toMatchObject({ determined: false, p: 999 });
    expect([e16(0, 0, 3), e16(20, 8, 1), e16(10, 4, 3)]).toEqual([0, 6, 19]);
  });
});

describe("where a reference is counted", () => {
  it("a fanfare counts with the card entered (CP02-064 counts itself among the iM@S followers)", () => {
    const two = position({ hand: ["CP02-064"], field: ["CP02-064", "CP02-064"] }, {});
    const r = two.rel("hand", 0, "CP02-064");
    expect([r("gate.n"), r("gate.ok"), r("rel.moved"), r("rel.live")]).toEqual([1, 1, 1, 1]);
    const one = position({ hand: ["CP02-064"], field: ["CP02-064"] }, {});
    const s = one.rel("hand", 0, "CP02-064");
    expect([s("gate.n"), s("gate.ok"), s("gate.gap")]).toEqual([1, 0, 1]);
    quiet(two.diag);
  });

  it("a played card left its hand: it can't pay a cost with itself (CP01-036, BP06-037)", () => {
    const alone = position({ hand: ["CP01-036"] }, { field: [A] });
    const r = alone.rel("hand", 0, "CP01-036");
    // Its "discard a card" cost and its target are under "pay" (a choice): one option, blocked with no other card.
    expect([r("alt.groups"), r("alt.ok"), r("avail.n")]).toEqual([1, 0, 0]);
    expect(r.traces.find((t) => t.ref.where === "canPay")!.count!.m).toBe(0);
    const two = position({ hand: ["CP01-036", A] }, { field: [A] });
    expect(two.rel("hand", 0, "CP01-036")("alt.ok")).toBe(1);
    const mysteria = position({ hand: ["BP06-037"] }, { field: [A] });
    expect(mysteria.rel("hand", 0, "BP06-037").traces.find((t) => t.ref.where === "canPay")!.count!.m).toBe(0);
  });

  it("DSD01b-003 counts itself; a gate in a resolution reads its direction", () => {
    const p = position({ hand: ["DSD01b-003"], field: ["DSD01b-003", "DSD01b-003"] }, {});
    const r = p.rel("hand", 0, "DSD01b-003");
    expect([r("gate.ok"), r("rel.moved")]).toEqual([1, 1]);
  });

  it("a last word counts with the card gone: its target among the others, itself in the cemetery", () => {
    const alone = position({ field: ["CSD02b-009"] }, {});
    const t = alone.rel("field", 0, "CSD02b-009").traces.find((x) => x.ref.timing === "lastWords")!;
    expect([t.live, t.count!.m, t.count!.inPlace]).toEqual([true, 0, 1]);
    const withCool = position({ field: ["CSD02b-009", "CSD02b-009"] }, {});
    expect(withCool.rel("field", 0, "CSD02b-009").traces.find((x) => x.ref.timing === "lastWords")!.count!.m).toBe(1);
    // A last word counting followers in its own cemetery finds itself there (not a token, CR 9.1.4.4).
    const tbl = withRefs({ [X]: [ref({ timing: "lastWords", ability: 0, key: undefined, where: "resolve", zones: ["cemetery"], filter: { t: "type", v: "follower" } })] });
    const dies = position({ field: [X], cemetery: [A] }, {}, { table: tbl });
    const r = dies.rel("field", 0, X);
    expect([r("aff.n"), r("aff.m"), r("rel.moved")]).toEqual([1, 2, 1]);
  });

  it("an evolving follower becomes its evolve card and keeps its place (CSD02b-006, CP01-041)", () => {
    const alone = position({ field: ["CSD02b-005"] }, {});
    expect(evolveRefColumns(alone.dom, alone.token("field", 0, "CSD02b-005"), ["CSD02b-006"])).toEqual({ refN: 1, refOk: 0, scale: 0 });
    const withCool = position({ field: ["CSD02b-005", "CSD02b-009"] }, {});
    expect(evolveRefColumns(withCool.dom, withCool.token("field", 0, "CSD02b-005"), ["CSD02b-006"])).toEqual({ refN: 1, refOk: 1, scale: 0 });
    const week = position({ field: ["CP01-040", "CP01-040", "CP01-036"] }, {});
    expect(evolveRefColumns(week.dom, week.token("field", 0, "CP01-040"), ["CP01-041"]).scale).toBe(2);
  });
});

describe("a comparison's direction and role", () => {
  it("BP10-109's fanfare needs no other follower; CSD02b-003 no other Cool follower", () => {
    expect(position({ hand: ["BP10-109"] }, { field: [A] }).rel("hand", 0, "BP10-109")("gate.ok")).toBe(1);
    const other = position({ hand: ["BP10-109"], field: [A] }, { field: [A] }).rel("hand", 0, "BP10-109");
    expect([other("gate.ok"), other("gate.gap")]).toEqual([0, 1]);
    expect(position({ field: ["CSD02b-003"] }, {}).rel("field", 0, "CSD02b-003")("gate.ok")).toBe(1);
    expect(position({ field: ["CSD02b-003", "CSD02b-009"] }, {}).rel("field", 0, "CSD02b-003")("gate.ok")).toBe(0);
  });

  it("BP03-020 evolves with 2 cards or fewer in hand; DSD01b-001 and CP01-076 are bonuses; CP04-069 a gate", () => {
    expect(position({ field: ["BP03-020"], hand: [A, B] }, {}).rel("field", 0, "BP03-020")("gate.ok")).toBe(1);
    const three = position({ field: ["BP03-020"], hand: [A, B, A] }, {}).rel("field", 0, "BP03-020");
    expect([three("gate.ok"), three("gate.gap")]).toEqual([0, 1]);
    const romaronia = position({ field: ["DSD01b-001"] }, {}).rel("field", 0, "DSD01b-001");
    expect([romaronia("bonus.n"), romaronia("bonus.ok"), romaronia("scale.n")]).toEqual([1, 1, 1]);
    const ardan = position({ field: ["CP01-076"] }, {}).rel("field", 0, "CP01-076");
    expect([ardan("bonus.n"), ardan("bonus.ok")]).toEqual([1, 1]);
    const kaori = position({ field: ["CP04-069", "CP04-069"] }, {}).rel("field", 0, "CP04-069");
    expect([kaori("gate.n"), kaori("gate.ok")]).toEqual([1, 1]);
    expect(position({ field: ["CP04-069"] }, {}).rel("field", 0, "CP04-069")("gate.ok")).toBe(0);
  });
});

describe("which references are live", () => {
  it("BP11-058 in hand: its fanfare scales with my big dragons, its hand ability needs a second one; dead on the field", () => {
    const big = ["BP11-058", "BP11-058", "BP11-058", "BP11-058"];
    const neutralSeven = engine.db.all().find((d) => d.class === "Neutral" && d.cost !== null && d.cost >= 7 && d.type === "follower" && !d.token && !d.evolved)!.id;
    const p = position({ hand: ["BP11-058"], cemetery: [...big, neutralSeven] }, { field: [A, A, B, B, A] });
    const r = p.rel("hand", 0, "BP11-058");
    expect([r("scale.n"), r("scale.m"), r("scale.rem"), r("avail.n"), r("avail.ok")]).toEqual([1, 4, 4, 2, 1]);
    expect(r.traces.find((t) => t.ref.where === "canPay")!.odds!.value).toBe(false);
    const pair = position({ hand: ["BP11-058", "BP11-058"], cemetery: big }, { field: [A] }).rel("hand", 0, "BP11-058");
    expect(pair.traces.find((t) => t.ref.where === "canPay")!.odds!.value).toBe(true);
    const onField = position({ field: ["BP11-058"], cemetery: big }, { field: [A] }).rel("field", 0, "BP11-058");
    expect([onField("rel.live"), onField("rel.dead")]).toEqual([0, 3]);
  });

  it("a crest's reference is live in the EX area; an equipment token's counts with its follower; selfKeywords in hand", () => {
    const crest = position({ ex: ["BP20-T01"] }, { field: [A] }).rel("ex", 0, "BP20-T01");
    expect([crest("rel.live"), crest("avail.ok")]).toEqual([1, 1]);
    const equip = position({ field: [{ card: A, equipped: ["CP04-T01"] }, B] }, {}).rel("equipmentZone", 0, "CP04-T01");
    expect([equip("rel.live"), equip("scale.m")]).toEqual([1, 2]);
    const mena = position({ hand: ["BP13-033"], cemetery: ["BP13-030", "BP13-030", "BP13-031", "BP13-032", "BP13-033"] }, {}).rel("hand", 0, "BP13-033");
    expect([mena("rel.live"), mena("gate.ok")]).toEqual([1, 1]);
  });
});

describe("choice groups", () => {
  it("counts the ways to play a card that find their cards (BP13-035, BP13-025, DSD01a-001, BP08-037)", () => {
    const all = position({ hand: ["BP13-035"], deck: ["BP13-030", "BP13-032", "BP13-033"] }, {}).rel("hand", 0, "BP13-035");
    expect([all("alt.groups"), all("alt.ok")]).toEqual([2, 2]);
    const mona = position({ hand: ["BP13-035"], deck: ["BP13-032", A] }, {}).rel("hand", 0, "BP13-035");
    expect([mona("alt.groups"), mona("alt.ok")]).toEqual([2, 1]);
    // BP13-025's options are its keys: "+2 play points" (its base references, the target among them, are factors of it).
    const justice = position({ hand: ["BP13-025"], deck: ["BP02-027", "BP02-018"] }, {}).rel("hand", 0, "BP13-025");
    expect([justice("alt.groups"), justice("alt.ok"), justice("avail.ok")]).toEqual([1, 0, 1]);
    const anne = position({ hand: ["DSD01a-001"], deck: ["DSD01a-008", "DSD01a-002"], cemetery: Array(9).fill("DSD01a-015") }, {}).rel("hand", 0, "DSD01a-001");
    expect([anne("alt.groups"), anne("alt.ok"), anne("bonus.n"), anne("bonus.ok")]).toEqual([2, 2, 1, 0]);
    const costs = (n: number) => vanilla.filter((d) => engine.db.get(d).cost === n);
    const prophetess = position({ hand: ["BP08-037"], cemetery: [1, 2, 3].flatMap((c) => costs(c).slice(0, 1)) }, {}).rel("hand", 0, "BP08-037");
    expect([prophetess("alt.groups"), prophetess("alt.ok"), prophetess("alt.unc")]).toEqual([1, 0, 0]);
  });
});

describe("the opponent's hidden cards and luck", () => {
  // An opponent's field card counting their own hand: 3 cards I can't see, 10 unseen cards of which 4 are A.
  const tbl = withRefs({ [X]: [ref({ zones: ["hand"], filter: { t: "defs", v: [A] }, test: { kind: "atLeast", n: 1, role: "gate" } })] });
  const opp: Side = { field: [X], hand: [A, B, B], deck: [A, A, A, B, B, B, B] };
  it("draws them from the cards I haven't seen, exactly", () => {
    const p = position({}, opp, { table: tbl });
    const r = p.rel("field", 1, X);
    expect([r("gate.n"), r("gate.unc"), r("gate.p"), r("rel.unc")]).toEqual([1, 1, round1000(binom(10, 3) - binom(6, 3), binom(10, 3)), 1]);
    expect(r("gate.p")).toBe(833);
    quiet(p.diag);
  });
  it("a remembered card is certain (and out of the unseen pool)", () => {
    const p = position({}, opp, {
      table: tbl,
      remember: (game) => {
        const a = game.state.players[1].zones.hand.find((id) => game.state.cards[id]!.def === A)!;
        game.state.cards[a]!.knownBy = [0];
      },
    });
    const r = p.rel("field", 1, X);
    expect([r("gate.ok"), r("gate.unc"), p.dom.N]).toEqual([1, 0, 9]);
    quiet(p.diag);
  });
  it("the deck's top is luck: BP10-054 with 8 of 20 cards costing 5 or more", () => {
    const deck = [...Array(8).fill("BP11-058"), ...Array(12).fill(A)];
    const r = position({ hand: ["BP10-054"], deck }, {}).rel("hand", 0, "BP10-054");
    expect([r("luck.n"), r("luck.p"), r("luck.e16"), r("rel.unc")]).toEqual([1, 400, 6, 1]);
  });
  it("a random result is not implemented yet: counted", () => {
    const random = withRefs({ [X]: [ref({ chance: "random", zones: ["deck"], test: { kind: "atLeast", n: 1, role: "gate" } })] });
    const p = position({ field: [X] }, {}, { table: random });
    const r = p.rel("field", 0, X);
    expect([p.diag.refRandom, r("rel.partial")]).toEqual([1, 1]);
  });
});

describe("the counting module is fair by construction", () => {
  it("reads no game, only the view (static guard)", () => {
    const source = readFileSync(join(__dirname, "..", "src", "encoder-v2-refs.ts"), "utf8");
    expect(source).not.toMatch(/GameSession|\.reader\(|\.state\b|determinized|clone\(|ALL_SCRIPTS|ALL_CARDS|createEngine|newGame|\.act\(|scripts\[/);
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.every((i) => ["./core", "./card-features", "./encoder"].includes(i!))).toBe(true);
    expect(source.match(/\.known\?\./g)).toHaveLength(1);
  });
});
