import { useState } from "react";
import { useSettings } from "../../app/settings";
import { useApp } from "../../app/store";
import { shownPrinting } from "../../app/token-art";
import { hostApi } from "../../host/api";
import { unknownImageUrl } from "../../resources/lookup";
import { useResourcesVersion } from "../../resources/resources";

interface Props {
  printing: string | null;
  def: string;
  back?: boolean;
  name: string;
  subtitle?: string;
  /** This printing as it is: a token's chosen art doesn't replace it (the token art window lists them all). */
  exact?: boolean;
}

/**
 * A card's picture (the player's own first, then the scraped one, README "Custom resources"); a token's with the printing
 * chosen in the settings (token-art.ts). Without one: the "unknown" picture (Misc/unknown) with the card's name on it, or
 * just the name.
 */
export function CardArt({ printing, def, back = false, name, subtitle, exact = false }: Props) {
  useResourcesVersion();
  const catalog = useApp((s) => s.catalog);
  const { tokenArt } = useSettings();
  const shown = exact ? printing : shownPrinting(catalog, tokenArt, def, printing);
  const src = shown ? hostApi.cardArtUrl(shown, def, back) : null;
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    const unknown = unknownImageUrl();
    return (
      <div className={`sve-card-placeholder${unknown ? " sve-card-unknown" : ""}`} data-printing={shown ?? undefined}>
        {unknown ? <img className="sve-card-art sve-card-unknown-art" src={unknown} alt="" draggable={false} /> : null}
        <span className="sve-card-placeholder-name">{name}</span>
        {subtitle ? <span className="sve-card-placeholder-sub">{subtitle}</span> : null}
      </div>
    );
  }
  return <img className="sve-card-art" src={src} alt={name} loading="lazy" draggable={false} onError={() => setFailed(src)} data-printing={shown ?? undefined} />;
}
