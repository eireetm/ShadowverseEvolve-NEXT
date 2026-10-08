// Traditional Chinese: the Simplified Chinese texts — the interface's and the cards' — converted, with OpenCC's dictionaries
// (opencc-js: phrases first, so 头发 → 頭髮 and 皇后 stays; the usual character forms: 為, 裡, 著). Nothing else differs.
// The dictionaries are big: they are loaded when Traditional Chinese is first chosen (until then a text stays as it is).
import { subscribeSettings, updateSettings, type CardLang, type Settings, type UiLang } from "../app/settings";

let convert: ((text: string) => string) | null = null;
let loading: Promise<void> | null = null;
const converted = new Map<string, string>();

/** Load the converter (once). */
export function loadHant(): Promise<void> {
  loading ??= import("opencc-js/cn2t").then((OpenCC) => {
    convert = OpenCC.Converter({ from: "cn", to: "tw" });
  });
  return loading;
}

/** Simplified Chinese text in Traditional Chinese (as it is while the converter isn't loaded). */
export function toHant(text: string): string {
  if (!convert || text === "") return text;
  let out = converted.get(text);
  if (out === undefined) {
    out = convert(text);
    converted.set(text, out);
  }
  return out;
}

/** Do these settings show Traditional Chinese anywhere? */
export const usesHant = (s: Pick<Settings, "uiLang" | "cardLang">): boolean => s.uiLang === "zh-Hant" || s.cardLang === "zh-Hant";

/** When the settings come to show Traditional Chinese (the settings file changed), load the converter, then show it all again. */
export function followSettings(): void {
  subscribeSettings((s) => {
    if (usesHant(s) && !convert) void loadHant().then(() => updateSettings({}));
  });
}

/** The interface languages that have their own messages: Traditional Chinese is the Simplified Chinese ones, converted. */
export type MessagesLang = Exclude<UiLang, "zh-Hant">;

/** The card data's languages: Traditional Chinese is the Chinese card text and names, converted. */
export type DataLang = Exclude<CardLang, "zh-Hant">;
export const dataLang = (lang: CardLang): DataLang => (lang === "zh-Hant" ? "cn" : lang);

/** Something worked out in the card data's language, in `lang` (converted for Traditional Chinese). */
export function inCardLang<T extends string | null>(lang: CardLang, make: (data: DataLang) => T): T {
  const out = make(dataLang(lang));
  return lang === "zh-Hant" && out !== null ? (toHant(out) as T) : out;
}
