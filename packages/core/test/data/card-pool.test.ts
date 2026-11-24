import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CardDatabase } from "../../src";
import { ALL_CARDS, ALL_SCRIPTS, SETS, SUPPORTED_SETS } from "../../src/sets";
import { hasDataTexts, withDataTexts } from "../../../../tools/lib/card-texts";

// The whole card pool: cards of every supported set with their printings in all sets.
const db = new CardDatabase(ALL_CARDS);
/** With this machine's card texts (not in the repository; the core has none): the checks of texts need them. */
const withTexts = new CardDatabase(withDataTexts(ALL_CARDS));

describe("card pool (all supported sets)", () => {
  it("every supported set has its data and script registry", () => {
    for (const set of SUPPORTED_SETS) {
      // A set of reprints only (ETD01, PCS02, ...) has no definition of its own: its printings belong to earlier cards.
      const printed = ALL_CARDS.some((c) => c.printings.some((p) => p.startsWith(`${set}-`)));
      expect(SETS[set].cards.length > 0 || printed, set).toBe(true);
      for (const id of Object.keys(SETS[set].scripts)) expect(db.get(id).id.startsWith(`${set}-`), id).toBe(true);
    }
    expect(Object.keys(ALL_SCRIPTS).length).toBe(SUPPORTED_SETS.reduce((n, s) => n + Object.keys(SETS[s].scripts).length, 0));
  });

  /**
   * A printing with a big name of its own and the card name in small type above it (CP02's units, CP04's groups, BP06's
   * hololive printings, BP08-U07) is that card: the data names it by its big name, so a new set's such printing comes in
   * as a card of its own. Check its image (assets/<no>/<no>.webp) and merge it with `treated_as` in data/fixes.ts — the
   * printed name becomes an alternate name, shown only (CR 2.13). Different cards that only share a text stay apart, listed
   * here with the reason.
   */
  it.skipIf(!hasDataTexts())("no two cards are the same but for their names (an unmerged printing with its own big name)", () => {
    const SAME_TEXT_ONLY = new Set([
      // サンライトシスター / 鉄拳の神父: Evolve (1), Ward, 4/4 for 4 — two Havencraft cards, no card name in small type.
      "BP12-097 BP16-105",
    ]);
    const groups = new Map<string, string[]>();
    for (const c of withTexts.all()) {
      // The text without its reference block (a printing may lack the tokens' lines).
      const body = (c.text.ja ?? "").split(/\n―{3,}/)[0]!.replace(/\s+/g, "");
      if (body === "") continue;
      const key = JSON.stringify([c.type, c.class, c.evolved, c.token, c.cost, c.attack, c.defense, [...c.traits].sort(), c.universe ?? null, body]);
      groups.set(key, [...(groups.get(key) ?? []), c.id]);
    }
    const same = [...groups.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort().join(" "));
    expect(same.filter((ids) => !SAME_TEXT_ONLY.has(ids))).toEqual([]);
  });

  it.skipIf(!hasDataTexts())("every card with a text has a Chinese text (else the Chinese interface shows English; fixed in data/fixes.ts)", () => {
    const missing = withTexts.all().filter((c) => c.text.ja && !c.text.cn).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("printings of other sets join their card: reprinted tokens, starter decks, promos", () => {
    expect(db.ofPrinting("BP02-T11").id).toBe("BP01-T03"); // Fairy
    expect(db.ofPrinting("SD01-007").id).toBe("BP01-017"); // Elf Metallurgist
    expect(db.ofPrinting("PR-088").id).toBe("BP01-009"); // Elven Princess Mage
    // Data fix (data/fixes.ts): ETD02-007 is Soul Conversion despite its English name.
    expect(db.ofPrinting("ETD02-007").id).toBe("BP01-116");
  });

  it("custom sets (data/custom.ts): DIY01's alternate arts join their cards, its leaders are new cards", () => {
    const of = ["DIY01-001", "DIY01-002", "DIY01-003", "DIY01-004", "DIY01-005", "DIY01-007", "DIY01-008"].map((p) => db.ofPrinting(p).id);
    expect(of).toEqual(["BP05-T03", "BP06-T01", "BP01-T03", "BP01-T02", "BP06-T02", "BP01-T15", "DIY01-006"]);
    const leaders = ["DIY01-006", "DIY01-009"].map((id) => db.get(id)).map((c) => [c.type, c.class, c.names]);
    expect(leaders).toEqual([
      ["leader", "Runecraft", { en: "Haishee", cn: "海曦", ja: "カイヒ" }],
      ["leader", "Forestcraft", { en: "Maiya Shiori", cn: "莓野诗织", ja: "莓野しおり" }],
    ]);
  });

  it("CR 2.13 — alternate-name printings belong to the card they are treated as", () => {
    const vania = db.ofPrinting("BP02-070");
    expect([vania.id, vania.name]).toEqual(["BP02-069", "Vania, Vampire Princess"]);
    expect(vania.alternateNames?.["BP02-070"]?.en).toBe("La+ Darkness, Laplace's Demon");
    expect(db.ofPrinting("BP02-082").id).toBe("BP02-081");
    expect(db.named("La+ Darkness, Laplace's Demon")).toEqual([]);
    // Printings with a big name of their own and the card name in small type above it (data/fixes.ts): BP06's hololive
    // printings, BP08-U07.
    const of = ["BP06-036", "BP06-SP01", "BP06-043", "BP06-057", "BP06-SP02", "BP06-062", "BP08-U07"].map((p) => db.ofPrinting(p).id);
    expect(of).toEqual(["BP06-035", "BP06-035", "BP06-042", "BP06-056", "BP06-056", "BP06-061", "BP08-108"]);
    expect(db.ofPrinting("BP06-036").alternateNames?.["BP06-036"]?.ja).toBe("澄明なる頭脳・博衣こより");
    // CP05's (pre-release, named in Japanese): the small-type names on SP01 / SSP01a / SSP01b, SP02 / SSP02a / SSP02b, U03,
    // U05, U07, U11.
    const cp05 = ["SP01", "SSP01a", "SSP01b", "SP02", "SSP02a", "SSP02b", "U03", "U05", "U07", "U11"].map((p) => db.ofPrinting(`CP05-${p}`).id);
    expect(cp05).toEqual(["CP05-094", "CP05-094", "CP05-094", "CP05-106", "CP05-106", "CP05-106", "CP05-019", "CP05-037", "CP05-055", "CP05-107"]);
    expect(db.named("誓約の騎士・ヴィーラ＆カタリナ")).toEqual([]);
    expect(db.get("CP05-107").alternateNames?.["CP05-U11"]).toEqual({ en: "unavailable", cn: "十天众统御者·古兰&姬塔", ja: "十天衆を総べし者・グラン＆ジータ" });
  });

  it.skipIf(!hasDataTexts())("uses effect_en where the scraped official English text belongs to another card", () => {
    // BP02-091's official field holds another card's fanfare; the card's own text is effect_en.
    expect(withTexts.get("BP02-091").text.en).toMatch(/prayer counter/);
    expect(withTexts.get("BP02-091").text.ja).toMatch(/祈りカウンター/);
  });

  // The texts tell the hosts of evolved cards named otherwise ("in its name").
  it.skipIf(!hasDataTexts())("CR 5.16.1.1.1 — every evolved card has exactly one base follower with the same name", () => {
    // Evolved spells are evolve-deck resources, not evolved forms: Carrot (CR 14.2.1), Drive Point (14.4.9).
    for (const e of ALL_CARDS.filter((c) => c.evolved && c.type !== "spell")) {
      const same = db.named(e.name).filter((d) => !d.evolved && d.type === "follower");
      if (same.length === 1) continue;
      // "Unless specified otherwise": evolved into from a card whose text names a string this
      // card's name contains (BP03-056 evolves into BP03-058 "Lævateinn Dragon, Attack Form"),
      // or whose evolve ability names this card (the faces of a double-faced card, BP09-004).
      const hosts = withTexts.all().filter(
        (d) =>
          !d.evolved &&
          d.type === "follower" &&
          ((e.name.includes(d.name) && d.text.en.includes("in its name")) ||
            (ALL_SCRIPTS[d.id]?.abilities ?? []).some((a) => a.kind === "activated" && (a.evolveInto?.includes(e.name) ?? false))),
      );
      expect(hosts, e.id).toHaveLength(1);
    }
  });

  it("CR 2.14 — a double-faced card's back face is its own definition, linked to the front", () => {
    const front = db.get("BP09-005");
    const back = db.get("BP09-005_back");
    expect([front.name, front.backFace, back.name, back.frontFace]).toEqual([
      "Paula, Gentle Warmth",
      "BP09-005_back",
      "Paula, Passionate Warmth",
      "BP09-005",
    ]);
    // The back face's Japanese traits and text are transcribed from the card (data/fixes.ts).
    expect(back.traits).toEqual(["妖精"]);
    if (hasDataTexts()) expect(withTexts.get("BP09-005_back").text.ja).toMatch(/コンボ_3/);
    expect([back.evolved, back.attack, back.defense, back.printings]).toEqual([true, 3, 3, []]);
    // Every printing of the card is the front (the physical card).
    expect(db.ofPrinting("BP09-P02").id).toBe("BP09-005");
    expect(db.get("BP09-019_back").traits).toEqual(["指揮官", "キラー"]);
  });

  it("every trait a script names exists on some card (catches untranslated trait names)", () => {
    const known = new Set(ALL_CARDS.flatMap((c) => c.traits));
    const root = join(__dirname, "../../src/script");
    let checked = 0;
    for (const set of readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())) {
      for (const file of readdirSync(join(root, set))) {
        for (const [, trait] of readFileSync(join(root, set, file), "utf8").matchAll(/hasTrait\("([^"]*)"\)/g)) {
          expect(known.has(trait!), `${set}/${file}: hasTrait("${trait}")`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
    // Reads every script file: about a second alone, much longer while the whole suite runs in parallel.
  }, 60_000);
});
