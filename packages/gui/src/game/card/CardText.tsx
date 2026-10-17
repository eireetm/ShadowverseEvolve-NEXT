import type { ReactNode } from "react";
import type { CardLang } from "../../app/settings";
import { htmlLang } from "../../i18n";
import { iconUrl } from "../../resources/lookup";
import type { TextLinks } from "./token-links";
import { tokenLabel } from "./tokens";

function Token({ name, lang }: { name: string; lang: CardLang }) {
  const label = tokenLabel(name, lang);
  const icon = iconUrl(name);
  if (icon) return <img className="sve-token-icon" src={icon} alt={label} title={label} />;
  const kind = /^cost/i.test(name) ? "cost" : name.endsWith("craft") ? "class" : name;
  return <span className={`sve-token sve-token-${kind}`}>{label}</span>;
}

/** Words of card text with their {[...]} icons drawn. */
function iconParts(text: string, lang: CardLang, key: string): ReactNode[] {
  return text.split(/(\{\[[^\]]+\]\})/g).map((part, j) => {
    const token = /^\{\[([^\]]+)\]\}$/.exec(part);
    return token ? <Token key={`${key}:${j}`} name={token[1]!} lang={lang} /> : part;
  });
}

/**
 * A line of card text (its `index`th): its words, its {[...]} icons drawn, and its links (when given). A link is inline text
 * acting as a button (not a <button>, which is laid out as one box: a long name couldn't wrap with the words around it).
 */
function lineParts(line: string, lang: CardLang, links?: TextLinks, index = 0): ReactNode[] {
  const found = links?.find(index) ?? [];
  if (found.length === 0) return iconParts(line, lang, "t");
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [i, link] of found.entries()) {
    if (link.start > at) parts.push(...iconParts(line.slice(at, link.start), lang, `t${i}`));
    const open = () => links!.open(link.def);
    parts.push(
      <span
        key={`l${i}`}
        role="button"
        tabIndex={0}
        className="sve-card-link"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          // As a button does: the keys click it.
          e.currentTarget.click();
        }}
        data-testid="card-text-link"
        data-def={link.def}
      >
        {line.slice(link.start, link.end)}
      </span>,
    );
    at = link.end;
  }
  if (at < line.length) parts.push(...iconParts(line.slice(at), lang, "end"));
  return parts;
}

/** A line of card text as plain words (the icons by their labels), for a tooltip. */
export function plainLine(line: string, lang: CardLang): string {
  return line.replace(/\{\[([^\]]+)\]\}/g, (_, name: string) => `[${tokenLabel(name, lang)}]`);
}

/** Card text with its icons; one paragraph per line. With `links`, the parts they find open other cards. */
export function CardText({ text, lang, links }: { text: string; lang: CardLang; links?: TextLinks }) {
  return (
    <div className="sve-card-text" lang={htmlLang(lang)}>
      {text.split("\n").map((line, i) => (
        <p key={i}>{lineParts(line, lang, links, i)}</p>
      ))}
    </div>
  );
}

/** One line of card text with its icons, inside a line of something else (an ability's line in a choice of abilities). */
export function CardTextLine({ line, lang, className }: { line: string; lang: CardLang; className?: string }) {
  return (
    <span className={className} lang={htmlLang(lang)}>
      {lineParts(line, lang)}
    </span>
  );
}
