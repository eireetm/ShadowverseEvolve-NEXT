// Resolve presentation identities using public core data/views only. Never import a core implementation registry.
import type { CardView, Engine, GameSession, PendingAbility } from "@sve/core";
import { findCard } from "../engine/view-utils";
import type { AbilityDisplayContext } from "./protocol";

/** Reviewed quote providers for runtime grants, including sources no longer present after Last Words. */
export const GRANT_TEXT: Readonly<Record<string, { def: string; timing: string }>> = {
  destroyAtEnd: { def: "BP03-062", timing: "other" },
  bottomAtEnd: { def: "BP03-112", timing: "other" },
  followerStrike2: { def: "BP03-011", timing: "strike" },
  strikeRefreshOnce: { def: "BP06-018", timing: "strike" },
  lastWordsBanishSelf: { def: "BP07-038", timing: "lastWords" },
  buryAtEnd: { def: "BP21-073", timing: "other" },
  returnToHandAtEnd: { def: "BP08-106", timing: "other" },
  strikeByAttack: { def: "BP03-083", timing: "strike" },
  strikePlus2: { def: "BP12-029", timing: "strike" },
  strikeDamageLeaders2: { def: "BP14-T03", timing: "strike" },
  strikeLeaderLossDamage: { def: "BP15-PR14", timing: "strike" },
  machinaPlayPing: { def: "BP17-042", timing: "other" },
  lastWordsLeaderDraw: { def: "BP13-119", timing: "lastWords" },
  strikeDrawDiscard: { def: "ECP01-013", timing: "strike" },
  mainPhaseDamageYourLeader2: { def: "ECP02-061", timing: "other" },
  combatDamageRefreshOnce: { def: "CSD03b-002", timing: "other" },
};

type Identity = Pick<PendingAbility, "controller" | "source" | "sourceDef" | "ability"> & { id?: string };

export function abilitySource(engine: Engine, game: GameSession, identity: Identity, visibleSource?: CardView | null): AbilityDisplayContext {
  const { controller, source, sourceDef, ability: abilityIndex } = identity;
  const own = visibleSource === undefined ? findCard(game.view(controller), source) : visibleSource;
  const reader = own ? game.reader() : null;
  const shownDef = reader?.info(source).def.id;
  const printing = own?.evolvedWith ? reader?.card(own.evolvedWith)?.printing ?? own.printing : own?.printing;
  const context: AbilityDisplayContext = {
    ...(identity.id ? { pendingId: identity.id } : {}), controller, source, sourceDef, abilityIndex,
    origin: "printed",
    ...(own ? { sourceCard: { def: shownDef!, printing: printing ?? null } } : {}),
  };
  if (sourceDef.startsWith("kw:")) {
    const keyword = sourceDef.slice(3);
    context.origin = "keyword";
    context.keyword = keyword;
    context.timing = keyword === "drain" ? "other" : ["singleDrive", "twinDrive"].includes(keyword) ? "strike" : undefined;
    return context;
  }
  if (sourceDef.startsWith("grant:")) {
    context.origin = "granted";
    const grant = sourceDef.slice(6);
    const known = GRANT_TEXT[grant];
    if (!known || abilityIndex !== 0) return context;
    const providers = [...new Set(own?.gifts.filter((g) => g.ability === grant).map((g) => g.by) ?? [])];
    // Several instances may have different givers. The pending identity cannot distinguish them.
    const provider = providers.length === 1 ? providers[0] : undefined;
    context.providerDef = provider;
    context.timing = known.timing;
    context.textRef = { def: provider ?? known.def, timing: known.timing, rank: 0, count: 1, quoted: true };
    return context;
  }
  const equipment = sourceDef.startsWith("equip:");
  const def = equipment ? sourceDef.slice(6) : sourceDef;
  const abilities = (equipment ? engine.scripts[def]?.equipment?.abilities : engine.scripts[def]?.abilities) ?? [];
  const ability = abilities[abilityIndex];
  if (ability?.kind !== "automatic") return context;
  if (!equipment && context.sourceCard) context.sourceCard = { def, printing: def === shownDef ? printing ?? null : null };
  context.origin = equipment ? "equipment" : ability.delayed ? "delayed" : "printed";
  if (equipment) context.providerDef = def;
  context.timing = ability.timing;
  const same = (a: (typeof abilities)[number]) => a.kind === "automatic" && a.timing === ability.timing;
  context.textRef = {
    def, timing: ability.timing,
    rank: abilities.slice(0, abilityIndex).filter(same).length,
    count: abilities.filter(same).length,
    ...(equipment ? { quoted: true } : {}),
  };
  return context;
}
