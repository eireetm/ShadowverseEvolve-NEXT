// Token art (the settings' "Token art" window, TokenArtWindow.tsx): a token can be shown with any of its printings. The
// look only: the Core gives every token it makes its first printing and is never told; only the pictures change, and the
// card panel names the printing shown. A choice that isn't one of the token's printings any more is left out.
import type { Catalog } from "./catalog";

/** The printing to show for `printing` of definition `def`: the one chosen for a token, else `printing` itself. */
export function shownPrinting(catalog: Catalog | null, tokenArt: Readonly<Record<string, string>>, def: string, printing: string | null): string | null {
  const chosen = tokenArt[def];
  if (chosen === undefined || !catalog) return printing;
  const card = catalog.def(def);
  return card?.token && card.printings.includes(chosen) ? chosen : printing;
}

/** How many tokens are shown with another printing than their own. */
export function changedTokens(catalog: Catalog | null, tokenArt: Readonly<Record<string, string>>): number {
  if (!catalog) return 0;
  return Object.entries(tokenArt).filter(([def, printing]) => {
    const card = catalog.def(def);
    return !!card?.token && card.printings.includes(printing) && printing !== card.printings[0];
  }).length;
}

/** The choice with `printing` for token `def` (its own first printing: no choice). */
export function withTokenArt(tokenArt: Readonly<Record<string, string>>, def: string, printing: string, own: string): Record<string, string> {
  const { [def]: _, ...rest } = tokenArt;
  return printing === own ? rest : { ...rest, [def]: printing };
}
