import type { RawCardJson } from "./raw";

/**
 * Custom sets: cards made by the community (DIY01, 2026-10-07), which the scraped data doesn't have. Their printings are
 * listed here; their pictures are in a folder named after the set beside the assets folder (D:\SVE\DIY01\DIY01-001.png),
 * not in the repository. A printing is
 *  - an alternate art of a card the data has (`of`): a copy of that printing's data under the new number, so it joins the
 *    card's definition (CR 2.1.1) — nothing about the card changes;
 *  - or a new card, given in full (`card`). So far only leaders, which have no text and need no script.
 *
 * Pure: the build tool (tools/build-card-data.ts) gives the data of the printings `of` names.
 */
export type CustomPrinting = { no: string; image: string } & (
  | { of: string }
  | { card: { name_en: string; name_ja: string; name_cn: string; class: string; type: "Leader" } }
);

export const CUSTOM_SETS: Readonly<Record<string, readonly CustomPrinting[]>> = {
  DIY01: [
    { no: "DIY01-001", image: "DIY01-001.png", of: "BP05-T03" }, // Puppet
    { no: "DIY01-002", image: "DIY01-002.png", of: "BP06-T01" }, // Celestial Shikigami
    { no: "DIY01-003", image: "DIY01-003.jpg", of: "BP01-T03" }, // Fairy
    { no: "DIY01-004", image: "DIY01-004.jpg", of: "BP01-T02" }, // Fairy Wisp
    { no: "DIY01-005", image: "DIY01-005.png", of: "BP06-T02" }, // Paper Shikigami
    { no: "DIY01-006", image: "DIY01-006.jpg", card: { name_en: "Haishee", name_ja: "カイヒ", name_cn: "海曦", class: "Runecraft", type: "Leader" } },
    { no: "DIY01-007", image: "DIY01-007.png", of: "BP01-T15" }, // Forest Bat
    { no: "DIY01-008", image: "DIY01-008.jpg", of: "DIY01-006" }, // Haishee
    { no: "DIY01-009", image: "DIY01-009.png", card: { name_en: "Maiya Shiori", name_ja: "莓野しおり", name_cn: "莓野诗织", class: "Forestcraft", type: "Leader" } },
  ],
};

/**
 * A custom set's printings as scraped card files. `printing` gives the data of a printing an alternate art copies (an
 * earlier printing of the list too: DIY01-008 is DIY01-006's).
 */
export function customRawCards(set: string, list: readonly CustomPrinting[], printing: (no: string) => RawCardJson | undefined): RawCardJson[] {
  const out: RawCardJson[] = [];
  const find = (no: string) => out.find((r) => r.card_no === no) ?? printing(no);
  for (const p of list) {
    if (!p.no.startsWith(`${set}-`)) throw new Error(`${p.no} is not a ${set} number (data/custom.ts)`);
    const common = { card_no: p.no, set, image: p.image, custom: true as const, illustrator: null, rulings: null };
    if ("of" in p) {
      const original = find(p.of);
      if (!original) throw new Error(`${p.no}: no printing ${p.of} to be an alternate art of (data/custom.ts)`);
      out.push({ ...original, ...common });
      continue;
    }
    out.push({
      ...common,
      name_en: p.card.name_en,
      name_ja: p.card.name_ja,
      name_cn: p.card.name_cn,
      rarity: "-",
      class: p.card.class,
      card_type: [p.card.type],
      traits: ["-"],
      traits_ja: "",
      cost: null,
      atk: null,
      def: null,
      effect_en: "",
      effect_en_official: "",
      effect_ja: "",
      effect_ja_sve: "",
      effect_cn: "",
      flavor_text_ja: null,
      flavor_text_en: null,
    });
  }
  return out;
}
