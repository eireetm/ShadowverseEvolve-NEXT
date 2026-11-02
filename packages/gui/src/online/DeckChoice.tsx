// The deck to play online, as a room's preparation and the random match choose it: the game setup's first deck, checked under
// the game's format and restriction list.
import { useEffect, useState } from "react";
import { errorText } from "../app/errors";
import { updateSettings, useSettings } from "../app/settings";
import { reportError, useApp } from "../app/store";
import { cardCount, type DeckFile } from "../decks/format";
import type { FormatId } from "../engine/protocol";
import { formatProblemText, type FormatProblem } from "../formats/formats";
import { hostApi, type DeckFileEntry } from "../host/api";
import { useT } from "../i18n";
import type { Rules } from "../net/messages";
import { problemsUnder } from "../net/online";

export interface DeckStatus {
  deck: DeckFile;
  problems: FormatProblem[];
}

/** The chosen deck's file, the decks to choose from (null: not listed yet), and the deck checked under `rules` (null: not yet). */
export function useDeckChoice(rules: Pick<Rules, "format" | "list"> | null): { file: string; decks: DeckFileEntry[] | null; status: DeckStatus | null } {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const file = useSettings().setupDecks[0];
  const [decks, setDecks] = useState<DeckFileEntry[] | null>(null);
  const [status, setStatus] = useState<DeckStatus | null>(null);
  useEffect(() => {
    hostApi.listDecks().then(setDecks, (err: unknown) => reportError(String(err)));
  }, []);
  useEffect(() => {
    let live = true;
    setStatus(null);
    if (!catalog || !rules) return;
    hostApi
      .loadDeck(file)
      .then(async (deck) => {
        const problems = await problemsUnder(rules, deck, catalog);
        if (live) setStatus({ deck, problems });
      })
      .catch((err: unknown) => reportError(`${file}: ${errorText(err, t)}`));
    return () => {
      live = false;
    };
  }, [file, rules, catalog]);
  return { file, decks, status };
}

interface Props {
  file: string;
  decks: DeckFileEntry[] | null;
  status: DeckStatus | null;
  /** The game's format (null: not known yet), which the deck's problems are said to be of. */
  format: FormatId | null;
  disabled: boolean;
}

/** The deck, as a select, with what its check found. */
export function DeckChoice({ file, decks, status, format, disabled }: Props) {
  const t = useT();
  const settings = useSettings();
  const catalog = useApp((s) => s.catalog);
  const ctx = catalog ? { catalog, lang: settings.cardLang, t } : null;
  return (
    <>
      <label className="sve-field">
        <span>{t("setup.deck")}</span>
        <select value={file} disabled={disabled} onChange={(e) => updateSettings({ setupDecks: [e.target.value, settings.setupDecks[1]] })} data-testid="online-deck">
          {!decks?.some((d) => d.file === file) ? <option value={file}>{file}</option> : null}
          {(decks ?? []).map((d) => (
            <option key={d.file} value={d.file}>
              {d.name} ({d.file})
            </option>
          ))}
        </select>
      </label>
      <div className="sve-deck-status">
        {status === null ? (
          <span className="sve-note">{t("setup.loadingDeck")}</span>
        ) : (
          <>
            <span>{t("setup.deckSummary", { main: cardCount(status.deck.main), evolve: cardCount(status.deck.evolve) })}</span>
            {status.problems.length === 0 ? <span className="sve-ok">{t("setup.deckOk")}</span> : null}
            {status.problems.length > 0 && ctx && format ? (
              <div className="sve-problems" data-testid="online-deck-problems">
                {t("setup.deckProblems", { format: t(`format.${format}`) })}
                <ul>
                  {status.problems.map((problem, i) => (
                    <li key={i}>{formatProblemText(problem, ctx)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
