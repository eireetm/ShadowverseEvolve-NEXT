import { defaultAnswer, enumerateAnswers, randomAnswer, type Answer, type Decision, type RngState } from "./core";
import { choiceKey, distinctSelections, selectionKey, type SameCard } from "./distinct-answers";
import { fastAnswer, type CardLookup } from "./policy";

/**
 * The answers worth comparing for a decision, at most `max`, in tie-break order (the first one
 * wins a tie). Main phase: every action but ending the main phase (the bot compares against
 * ending it), playing one of several identical cards only once. Selections and choices: every
 * answer when there are few, otherwise the fast answer, the smallest ones and random samples,
 * because "any number of cards" can have millions. A Ward follower entering gets the fast answer only (policy.ts; the
 * planner compares both itself outside its own main phase, planner.ts wardOnEntry). Which Ward followers to engage at the end
 * phase is compared like any selection. Ordering cards gets the fast answer only. With `same` (distinct-answers.ts), the
 * selections and choices are told apart by what they choose: the different ones enumerated (a selection by the multiset of
 * its cards' signatures, a choice as a set), and the samples that repeat one left out; without it, the answers as they are.
 */
export function candidateAnswers(d: Decision, lookup: CardLookup, rng: RngState, max: number, attacksFirst = false, same?: SameCard): Answer[] {
  if (same && (d.type === "selectCards" || d.type === "choose")) return distinctCandidates(d, lookup, rng, max, same);
  const out: Answer[] = [];
  const seen = new Set<string>();
  const add = (a: Answer, key = JSON.stringify(a)) => {
    if (out.length < max && !seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  };
  const sampled = (limit: number) => {
    const all = enumerateAnswers(d, Math.max(1, limit - 6));
    for (const a of all.answers) add(a);
    if (!all.complete) for (let i = 0; i < 12; i++) add(randomAnswer(rng, d));
  };
  switch (d.type) {
    case "mainPhase":
      for (const action of attacksFirst ? attacksFirstOrder(d.actions, lookup, max) : d.actions) {
        if (action.type === "endMainPhase") continue;
        let key = JSON.stringify(action);
        if (action.type === "play") {
          const f = lookup(action.card);
          if (f) key = `play|${f.def}|${f.zone}|${String(f.cost)}`;
        } else if (action.type === "evolve") {
          const f = lookup(action.evolveCard);
          if (f) key = JSON.stringify({ ...action, evolveCard: f.def });
        }
        add({ type: "mainPhase", action }, key);
      }
      break;
    case "quick":
      add(defaultAnswer(d));
      for (const action of d.actions) add({ type: "quick", action });
      break;
    case "selectPending":
      for (const id of d.options) add({ type: "selectPending", id });
      break;
    case "selectCards":
      add(fastAnswer(d, lookup));
      if (d.reason !== "wardEnterEngaged") sampled(max);
      break;
    case "choose":
      add(fastAnswer(d, lookup));
      sampled(max);
      break;
    case "confirm":
      add({ type: "confirm", yes: true });
      add({ type: "confirm", yes: false });
      break;
    case "orderCards":
    case "mulligan":
    case "chooseTurnOrder":
      add(fastAnswer(d, lookup));
      break;
  }
  return out;
}

/**
 * candidateAnswers of a selection or a choice with `same`: the fast answer, the different answers the smallest first (at most
 * `max` − 6 listed before sampling, as enumerateAnswers is asked), and when those aren't all, 12 samples, each listed only if
 * it chooses something not listed yet.
 */
function distinctCandidates(d: Extract<Decision, { type: "selectCards" | "choose" }>, lookup: CardLookup, rng: RngState, max: number, same: SameCard): Answer[] {
  const out: Answer[] = [];
  const seen = new Set<string>();
  const keyOf = (a: Answer) => (a.type === "selectCards" ? selectionKey(a.cards, same) : a.type === "choose" ? choiceKey(a.ids) : JSON.stringify(a));
  const add = (a: Answer) => {
    const key = keyOf(a);
    if (out.length < max && !seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  };
  add(fastAnswer(d, lookup));
  if (d.type === "selectCards" && d.reason === "wardEnterEngaged") return out;
  const limit = Math.max(1, max - 6);
  const all = d.type === "selectCards" ? distinctSelections(d, same, limit) : enumerateAnswers(d, limit);
  add(defaultAnswer(d));
  for (const a of all.answers) add(a);
  if (!all.complete) for (let i = 0; i < 12; i++) add(randomAnswer(rng, d));
  return out;
}

type MainAction = Extract<Decision, { type: "mainPhase" }>["actions"][number];

/**
 * A model of a player with few candidates keeps its attacks (the engine lists them last): attacks on the leader first, at most
 * `max` − 4 of them, then the other actions (plays, evolutions, abilities: an evolution before an attack, a removal), then
 * the remaining attacks.
 */
function attacksFirstOrder(actions: readonly MainAction[], lookup: CardLookup, max: number): MainAction[] {
  const isAttack = (a: MainAction) => a.type === "attack";
  const atLeader = actions.filter((a) => a.type === "attack" && lookup(a.target)?.zone === "leader");
  const first = atLeader.slice(0, Math.max(1, max - 4));
  const rest = actions.filter((a) => !first.includes(a));
  return [...first, ...rest.filter((a) => !isAttack(a)), ...rest.filter(isAttack)];
}
