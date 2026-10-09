// Presentation entry point. Keep engine/worker.ts and the fingerprinted GameHost unchanged.
// Bootstrap, input handling and bot effort mirror engine/worker.ts; only output gains display details.
import { createEngine } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { timerScheduler } from "../engine/game-host";
import type { CatalogCard, ToWorker } from "../engine/protocol";
import { createPresentationHost } from "./host";
import type { FromWorker } from "./protocol";

interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const send = (message: FromWorker): void => scope.postMessage(message);
const describe = (err: unknown): string => (err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err));

try {
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const host = createPresentationHost(engine, send, timerScheduler, { botEffort: import.meta.env.MODE === "android" || import.meta.env.MODE === "ios" ? 0.5 : 1 });
  scope.onmessage = (event) => {
    try {
      host.handle(event.data);
    } catch (err) {
      send({ kind: "error", message: describe(err) });
    }
  };
  const catalog: CatalogCard[] = engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) }));
  send({ kind: "ready", catalog });
} catch (err) {
  send({ kind: "error", message: `the engine could not start: ${describe(err)}` });
}
