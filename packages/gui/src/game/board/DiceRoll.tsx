// A die rolled (CR 5.20; the dieRolled event: one per die, its final number after any reroll, ECP02-065): a window over the
// middle of the table with a die that tumbles and lands on the number, "The die shows 4" under it and who rolled above.
// It goes by itself once the die has stayed a moment (sooner when another roll is waiting) or at a click; dice rolled
// together are shown one after another. The sound "dice" (public/audio/sfx/dice) plays as the die tumbles; without
// animations the die shows its number at once. Only rolls that happen while the table is watched: not the ones of a
// table shown anew (a replay's jump, a rewind), nor again when the game screen is shown again. The bots' or the other
// program's next answer waits until the die has landed (the engine worker, diceLanded). The debug tab turns it off
// (Settings.diceRollsOff): no window, no sound, no wait; the rolls are in the log.
import type { PlayerId } from "@sve/core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getSettings, useSettings } from "../../app/settings";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { playSfx } from "../../resources/sound";
import { DICE } from "../animation/plan";
import { playerLabel } from "../labels";

interface Roll {
  key: string;
  player: PlayerId;
  result: number;
}

/** The updates whose rolls were taken (React runs a new screen's effects twice in development; a screen shown again). */
const taken = new WeakSet<GameUpdate>();
let rolls = 0;

/**
 * The die's faces (opposite faces add up to 7) and the turn that brings each to the front: [rotateX, rotateY] in degrees.
 * Pips are at a quarter, half and three quarters of the face.
 */
const FACES: { n: number; place: string; front: [number, number]; pips: [number, number][] }[] = [
  { n: 1, place: "rotateY(0deg)", front: [0, 0], pips: [[50, 50]] },
  { n: 2, place: "rotateY(90deg)", front: [0, -90], pips: [[25, 25], [75, 75]] },
  { n: 3, place: "rotateX(90deg)", front: [-90, 0], pips: [[25, 25], [50, 50], [75, 75]] },
  { n: 4, place: "rotateX(-90deg)", front: [90, 0], pips: [[25, 25], [75, 25], [25, 75], [75, 75]] },
  { n: 5, place: "rotateY(-90deg)", front: [0, 90], pips: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]] },
  { n: 6, place: "rotateY(180deg)", front: [0, 180], pips: [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]] },
];

export function DiceRoll({ update }: { update: GameUpdate }) {
  const t = useT();
  const { animations, diceRollsOff } = useSettings();
  const [queue, setQueue] = useState<Roll[]>([]);
  const [landed, setLanded] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    // A table shown anew, or the update the screen opened with: nothing to roll; nor with the window off.
    const opening = first.current;
    first.current = false;
    if (update.logReset) {
      setQueue([]);
      return;
    }
    if (taken.has(update)) return;
    taken.add(update);
    if (opening || getSettings().diceRollsOff) return;
    const found = update.log.flatMap(({ event }) => (event.type === "dieRolled" ? [{ key: `die-${++rolls}`, player: event.player, result: event.result }] : []));
    if (found.length > 0) setQueue((q) => [...q, ...found]);
  }, [update]);
  // Turned off while dice are shown: they go at once.
  useEffect(() => {
    if (diceRollsOff) setQueue([]);
  }, [diceRollsOff]);
  const current = queue[0] ?? null;
  const waiting = queue.length > 1;
  const next = () => {
    setLanded(false);
    setQueue((q) => q.slice(1));
  };
  // A new die: its sound, and it tumbles until it lands (at once without animations).
  useEffect(() => {
    if (!current) return;
    playSfx("dice");
    setLanded(!animations);
    if (!animations) return;
    const timer = window.setTimeout(() => setLanded(true), DICE.spin);
    return () => window.clearTimeout(timer);
  }, [current?.key]);
  // Landed: it stays, a shorter while when another roll is waiting, then the next one.
  useEffect(() => {
    if (!current || !landed) return;
    const timer = window.setTimeout(next, waiting ? DICE.next : animations ? DICE.stay : DICE.still);
    return () => window.clearTimeout(timer);
  }, [current?.key, landed, waiting]);
  if (!current) return null;
  const face = FACES[current.result - 1] ?? FACES[0]!;
  const turn = { "--sve-die-x": `${face.front[0]}deg`, "--sve-die-y": `${face.front[1]}deg` } as CSSProperties;
  return (
    <div className="sve-dice" role="status" aria-live="polite" onClick={next} data-testid="dice-roll" data-result={landed ? current.result : undefined}>
      <span className="sve-dice-who">{t("dice.who", { player: playerLabel(current.player, update, t) })}</span>
      <div className="sve-dice-stage" aria-hidden="true">
        <div key={current.key} className={animations ? "sve-die sve-die-rolling" : "sve-die"} style={turn}>
          {FACES.map((f) => (
            <div key={f.n} className={`sve-die-face sve-die-face-${f.n}`} style={{ transform: `${f.place} translateZ(calc(var(--sve-dice-size) / 2))` }}>
              {f.pips.map(([x, y], i) => (
                <span key={i} className="sve-die-pip" style={{ left: `${x}%`, top: `${y}%` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <strong className="sve-dice-result" data-testid="dice-result">
        {landed ? t("dice.result", { n: current.result }) : " "}
      </strong>
    </div>
  );
}
