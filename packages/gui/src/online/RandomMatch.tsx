// Random match ("随机匹配"), a page of the online screen: choose the format, the restriction list and the deck, and the program
// looks for a game by itself on the online servers (net/random-match.ts). While it looks, this page says how far it is and can
// stop it; a game that begins shows on the game screen, and the room goes on as any room after it.
import { useEffect, useMemo } from "react";
import { useBack } from "../app/back";
import { useApp } from "../app/store";
import { useFormat } from "../formats/check";
import { FormatPicker } from "../formats/FormatPicker";
import { useT } from "../i18n";
import { useOnline } from "../net/online";
import { startRandomMatch, stopRandomMatch, useRandomMatch } from "../net/random-match";
import { useServerConfig } from "../net/server-config";
import { DeckChoice, useDeckChoice } from "./DeckChoice";
import { useSeconds } from "./use-seconds";

interface Props {
  /** This program's fingerprint is known (the other program is compared with it). */
  identified: boolean;
  onBack: () => void;
  onEditDecks: () => void;
}

export function RandomMatch({ identified, onBack, onEditDecks }: Props) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const servers = useServerConfig().servers;
  const { format, list } = useFormat();
  const listId = list?.id ?? null;
  const wanted = useMemo(() => ({ format, list: listId }), [format, listId]);
  const { file, decks, status } = useDeckChoice(wanted);
  const { stage } = useRandomMatch();
  // Leaving the page stops looking (a game that has begun goes on).
  useEffect(() => stopRandomMatch, []);
  const back = () => {
    stopRandomMatch();
    onBack();
  };
  useBack(true, back);
  const canStart = identified && catalog !== null && servers.length > 0 && status !== null && status.problems.length === 0;
  const looking = stage !== "off";
  return (
    <div className="sve-online-step sve-online-random" data-testid="random-match">
      <h2>{t("online.random")}</h2>
      {looking ? (
        <Looking />
      ) : (
        <>
          <p className="sve-hint">{t("online.randomHelp")}</p>
          <fieldset className="sve-online-rules">
            <FormatPicker />
          </fieldset>
          <DeckChoice file={file} decks={decks} status={status} format={format} disabled={false} />
          <button type="button" className="sve-link-button" onClick={onEditDecks}>
            {t("setup.editDecks")}
          </button>
          <button
            type="button"
            className="sve-primary sve-menu-button"
            disabled={!canStart}
            onClick={() => {
              if (status && catalog) startRandomMatch(wanted, status.deck, catalog, servers);
            }}
            data-testid="random-start"
          >
            {t("online.randomStart")}
          </button>
          <button type="button" onClick={back} data-testid="random-back">
            {t("common.back")}
          </button>
        </>
      )}
    </div>
  );
}

/** How far the search is: looking (with a room of its own waiting for someone), going into a room, or in one. */
function Looking() {
  const t = useT();
  const { stage, since, hosting, problems } = useRandomMatch();
  const seconds = useSeconds(since);
  const { phase, prep } = useOnline();
  const several = useServerConfig().servers.length > 1;
  const peer = phase.kind === "connected" ? (phase.peer?.name ?? "") : "";
  return (
    <>
      <p data-testid="random-status" data-stage={stage} data-hosting={hosting ? "yes" : "no"}>
        {stage === "meeting" ? (peer ? t("online.randomMeetingName", { name: peer }) : t("online.randomMeeting")) : stage === "searching" ? t("online.randomSearching", { s: seconds }) : t("online.randomEntering")}
      </p>
      {stage === "searching" && hosting ? <p className="sve-hint">{t("online.randomHosting")}</p> : null}
      {stage === "meeting" ? <p className="sve-hint">{t(prep.starting ? "online.starting" : "online.bothReady")}</p> : null}
      {problems.map(({ server, problem }) => {
        const text = t("online.lobbyProblem", { why: t(`online.server.${problem}`) });
        return (
          <p key={server.address} className="sve-problem" data-testid="random-problem">
            {several ? t("online.server.at", { name: server.name, text }) : text}
          </p>
        );
      })}
      <button type="button" onClick={stopRandomMatch} data-testid="random-cancel">
        {t("online.cancel")}
      </button>
    </>
  );
}
