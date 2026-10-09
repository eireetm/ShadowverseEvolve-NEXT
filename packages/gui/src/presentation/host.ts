import type { Engine } from "@sve/core";
import { GameHost, timerScheduler, type GameHostOptions, type Scheduler } from "../engine/game-host";
import { cardRuntimeDetails } from "./card-details";
import type { FromWorker } from "./protocol";

/**
 * Wrap only the host's output, outside the online fingerprint. The underlying host owns all inputs,
 * scheduling and state; presentation must never change them. Non-update messages pass through intact.
 */
export function createPresentationHost(
  engine: Engine,
  send: (message: FromWorker) => void,
  scheduler: Scheduler = timerScheduler,
  options: GameHostOptions = {},
): GameHost {
  // GameHost's constructor does not publish. Every update is sent synchronously with an active session.
  const host = new GameHost(engine, (message) => {
    if (message.kind !== "update") return send(message);
    const session = host.session!;
    const cardDetails = cardRuntimeDetails(session.reader(), engine.scripts, message.update.view);
    send({ ...message, update: { ...message.update, cardDetails } });
  }, scheduler, options);
  return host;
}
