// The app's state: what the engine worker published (catalog, the game's latest update, the log) and the errors to show.
// Components read it with useApp(select); the worker's messages change it, and the card texts read the catalog's.
import { useSyncExternalStore } from "react";
import { EngineClient } from "../engine/client";
import type { CatalogCard, GameUpdate, LogEntry } from "../engine/protocol";
import { translate } from "../i18n";
import { cardTextProblems, onCardTexts, withShownTexts } from "../resources/card-texts";
import { playUpdateSounds } from "../resources/sound";
import { Catalog } from "./catalog";
import { getSettings } from "./settings";

export interface AppError {
  id: number;
  message: string;
}

export interface AppState {
  ready: boolean;
  /** The engine failed to start. */
  startError: string | null;
  catalog: Catalog | null;
  update: GameUpdate | null;
  log: LogEntry[];
  errors: AppError[];
}

let state: AppState = { ready: false, startError: null, catalog: null, update: null, log: [], errors: [] };
const listeners = new Set<() => void>();

/** The state now, outside React (online play reads how far the game is). */
export function getApp(): AppState {
  return state;
}

function setState(change: Partial<AppState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** The engine worker (one for the whole app). */
export const engine = new EngineClient();

let nextError = 1;

/** The catalog as the worker published it: without card texts, which the page reads (resources/card-texts.ts). */
let dataCatalog: CatalogCard[] | null = null;

const beforeUpdate = new Set<(update: GameUpdate) => void>();

/** Run `fn` with each update just before it is shown (the table's animations note where the cards were). */
export function onBeforeUpdate(fn: (update: GameUpdate) => void): () => void {
  beforeUpdate.add(fn);
  return () => beforeUpdate.delete(fn);
}

engine.subscribe((message) => {
  switch (message.kind) {
    case "ready":
      dataCatalog = message.catalog;
      setState({ ready: true, catalog: new Catalog(withShownTexts(message.catalog)) });
      break;
    case "update": {
      const update = message.update;
      for (const fn of beforeUpdate) fn(update);
      playUpdateSounds(update, state.update?.view ?? null, state.catalog, state.update?.announcement?.seq ?? null);
      setState({ update, log: update.logReset ? update.log : [...state.log, ...update.log] });
      break;
    }
    case "error":
      setState({
        ...(state.ready ? {} : { startError: message.message }),
        errors: [...state.errors, { id: nextError++, message: message.message }].slice(-8),
      });
      break;
    default:
      break;
  }
});

/** The player's text files told as unusable at the last reading (each is told once, not at every reading). */
let toldTextProblems = new Set<string>();

// The card texts read (again): the catalog with them; a file of the player's that couldn't be used is told.
onCardTexts(() => {
  if (dataCatalog) setState({ catalog: new Catalog(withShownTexts(dataCatalog)) });
  const problems = new Set(cardTextProblems());
  for (const file of problems) if (!toldTextProblems.has(file)) reportError(translate(getSettings().uiLang, "resources.ownTextBad", { file }));
  toldTextProblems = problems;
});

export function reportError(message: string): void {
  setState({ errors: [...state.errors, { id: nextError++, message }].slice(-8) });
}

export function dismissError(id: number): void {
  setState({ errors: state.errors.filter((e) => e.id !== id) });
}

/** Read part of the state; the selector must return a value from the state (not a new object), or React re-renders forever. */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}
