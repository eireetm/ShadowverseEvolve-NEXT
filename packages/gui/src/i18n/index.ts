import { useCallback } from "react";
import { useSettings, type CardLang, type UiLang } from "../app/settings";
import { en, type MessageKey } from "./en";
import { toHant, type MessagesLang } from "./hant";
import { ja } from "./ja";
import { zh } from "./zh";

export type { MessageKey } from "./en";

const MESSAGES: Record<MessagesLang, Record<MessageKey, string>> = { en, zh, ja };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A message with "{name}" parameters filled in. */
export function translate(lang: UiLang, key: MessageKey, params?: Record<string, string | number>): string {
  // Traditional Chinese: the Simplified Chinese message converted, before the parameters (names stay as they are given).
  const text = lang === "zh-Hant" ? toHant(zh[key] ?? en[key]) : (MESSAGES[lang][key] ?? en[key]);
  return params ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all)) : text;
}

/**
 * The lang attribute for text in an interface or card language: the browser draws the characters Chinese and Japanese
 * share in that language's forms (and the style picks its fonts, app.css).
 */
export function htmlLang(lang: UiLang | CardLang): string {
  return lang === "zh" || lang === "cn" ? "zh-CN" : lang;
}


export function useT(): Translate {
  const { uiLang } = useSettings();
  return useCallback<Translate>((key, params) => translate(uiLang, key, params), [uiLang]);
}
