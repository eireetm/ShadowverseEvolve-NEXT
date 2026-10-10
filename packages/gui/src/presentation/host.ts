import type { Engine } from "@sve/core";
import { GameHost, timerScheduler, type GameHostOptions, type Scheduler } from "../engine/game-host";
import { cardRuntimeDetails } from "./card-details";
import { observePresentationEngine } from "./effect-context";
import type { FromWorker } from "./protocol";

/**
 * Outside the online fingerprint: observe actual inputs and extend output. The underlying host
 * owns scheduling/state; each act is delegated once. Non-update messages pass through intact.
 */
export function createPresentationHost(
  engine: Engine,
  send: (message: FromWorker) => void,
  scheduler: Scheduler = timerScheduler,
  options: GameHostOptions = {},
): GameHost {
  const observed = observePresentationEngine(engine);
  // GameHost's constructor does not publish. Every update is sent synchronously with an active session.
  const host = new GameHost(observed.engine, (message) => {
    if (message.kind !== "update") return send(message);
    const session = host.session!;
    const cardDetails = cardRuntimeDetails(session.reader(), engine.scripts, message.update.view);
    const abilities = observed.observers.get(session)!.presentation(message.update);
    send({ ...message, update: { ...message.update, cardDetails, ...abilities } });
  }, scheduler, options);
  return host;
}
