/**
 * CR JP 14.6.2 (Granblue Fantasy; the English rules don't have it yet) — the attribute traits, and 全属性 ("all
 * attributes"): where a rule or an effect references one of the six attribute traits, it also references 全属性
 * (CR JP 14.6.2.2). A card with 全属性 doesn't have the six (it shows and counts its own traits), and a reference to
 * 全属性 is not one to the six. Every trait check of the engine and the scripts goes through `traitMatches`.
 */

/** CR JP 14.6.2.1 */
export const ALL_ATTRIBUTES_TRAIT = "全属性";

/** CR JP 14.6.2.2 — fire, water, earth, wind, light and dark. */
export const ATTRIBUTE_TRAITS: readonly string[] = ["火属性", "水属性", "土属性", "風属性", "光属性", "闇属性"];

/** CR 2.4, CR JP 14.6.2.2 — does a card with these traits count as having `wanted` where a rule or an effect references it? */
export function traitMatches(traits: readonly string[], wanted: string): boolean {
  return traits.includes(wanted) || (traits.includes(ALL_ATTRIBUTES_TRAIT) && ATTRIBUTE_TRAITS.includes(wanted));
}
