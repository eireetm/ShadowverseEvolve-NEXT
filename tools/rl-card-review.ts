/**
 * The card feature table's review list, in Chinese, for a person: npm run rl:review [-- --games N]
 * For every card of the sample decks (the training and test decks): its Chinese text, the effects the table says it has (by
 * family), and what it counts (tools/rl/script-analysis.ts) written out in words — the zone, whose, which cards, a threshold
 * or a quantity, in which ability — with the check against the engine (tools/rl/ref-oracle.ts, on recorded games when the run
 * folders are there, else on generated ones) and marks where the text speaks of a cemetery, a trait or a class that no
 * reference covers. Writes docs/card-table-review.md (a local note; nothing in the repository reads it) and prints the lines
 * that changed since the file there, card by card.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_FEATURE_COLUMNS, refFrom, refPartial, type CardRef, type RefFilter } from "../packages/bot/src";
import { createEngine, randomAnswer, seedRng, type GameSession } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { withDataTexts } from "./lib/card-texts";
import { TRAIT_NAMES } from "../packages/gui/src/app/traits";
import { checkReferences } from "./rl/ref-oracle";
import { gameLines } from "./rl/records";
import { analyzeScripts } from "./rl/script-analysis";
import { DECK_SETS, ROOT, sampleDeck } from "./rl/series";

const args = process.argv.slice(2);
const games = Number(args[args.indexOf("--games") + 1] ?? 300) || 300;
// The card texts are this machine's files (lib/card-texts.ts): the core has none.
const engine = createEngine({ cards: withDataTexts(ALL_CARDS), scripts: ALL_SCRIPTS });
const analyses = analyzeScripts(ALL_SCRIPTS);

const ZONE: Record<string, string> = { field: "战场", cemetery: "墓场", hand: "手牌", deck: "牌组", ex: "额外区", evolveDeck: "进化牌组", banished: "消失领域", evolveZone: "进化区", leader: "主战者", other: "（某个区域）" };
const SIDE: Record<string, string> = { own: "我方", opp: "对方", both: "双方", "?": "某一方" };
const TIMING: Record<string, string> = {
  fanfare: "入场曲",
  lastWords: "谢幕曲",
  onEvolve: "进化时",
  onSuperEvolve: "超进化时",
  strike: "攻击时",
  turnStart: "主要阶段开始时",
  turnEnd: "结束阶段开始时",
  otherTrigger: "其他诱发能力",
  activated: "启动能力",
  evolve: "进化能力",
  spell: "法术",
  continuous: "常驻",
  fromHand: "在手牌时（使用的消费 / 条件）",
};
const WHERE: Record<string, string> = {
  condition: "条件",
  triggerIf: "诱发条件",
  max: "选择数量的上限",
  when: "能不能选择",
  target: "要选择的对象",
  targetCondition: "对选中的卡的条件",
  choose: "从中选择",
  topCard: "牌组顶的卡",
  affects: "受益的卡",
  trigger: "诱发条件的卡",
  each: "对每张",
  spellchain: "魔力连锁",
  necrocharge: "死灵术",
  search: "从牌组寻找",
  searchEach: "从牌组各寻找 1 张",
  fromEvolveDeck: "从进化牌组选",
  resolve: "效果处理",
  selfKeywords: "自身的关键词",
  keywordsFor: "给予关键词",
  playCost: "使用的消费",
  playCostOf: "其他卡的费用",
  playableIf: "能不能使用",
  canPay: "费用能不能支付",
  pay: "支付费用",
  modeCount: "可选的模式数",
  available: "能不能选这个模式",
  candidates: "候选",
  filter: "筛选",
  cannotAttackLeader: "不能攻击主战者",
  evolveCostChange: "进化费用",
};
const CLASS: Record<string, string> = { Neutral: "中立", Forestcraft: "精灵", Swordcraft: "皇家护卫", Runecraft: "巫师", Dragoncraft: "龙族", Abysscraft: "梦魇", Havencraft: "主教" };
const TYPE: Record<string, string> = { follower: "从者", amulet: "护符", spell: "法术", crest: "纹章", equipment: "装备" };
const FAMILY: Record<string, string> = {
  dmg: "伤害",
  aoe: "全体伤害",
  destroy: "破坏",
  banish: "消失",
  toHand: "回到手牌",
  stats: "攻击力 / 生命值",
  keyword: "给予关键词",
  heal: "主战者生命",
  draw: "抽牌",
  search: "检索 / 查看",
  summon: "召唤",
  ex: "额外区",
  discard: "舍弃",
  mill: "牌组送墓",
  bury: "埋葬",
  pp: "PP",
  cost: "费用变化",
  counters: "指示物",
  evolve: "进化",
  engage: "横置",
  refresh: "重置",
  protect: "伤害减免 / 保护",
  restrict: "限制",
  deck: "放回牌组",
  other: "其他",
};
const cnName = (def: string) => engine.db.get(def).names.cn ?? engine.db.get(def).name;
const trait = (t: string) => TRAIT_NAMES[t]?.cn ?? t;

/** The analyzer's reasons for a part it couldn't read, in words. */
const UNREAD: Record<string, string> = {
  "cost ?": "消费要和当时的数值比",
  keyword: "有某个关键词",
  "evolve ability": "有【进化】能力",
  "predicate unknown": "筛选条件",
  "predicate cond": "筛选条件",
};

/** A filter in words. */
function filterText(f: RefFilter): string {
  switch (f.t) {
    case "any":
      return "任何卡";
    case "type":
      return TYPE[f.v] ?? f.v;
    case "trait":
      return `${trait(f.v)}类型`;
    case "class":
      return `${CLASS[f.v] ?? f.v}职业`;
    case "name":
      return `名为『${cnName(engine.db.all().find((d) => d.name === f.v)?.id ?? "") || f.v}』`;
    case "nameIncludes": {
      const names = [...new Set(engine.db.all().filter((d) => d.name.includes(f.v)).map((d) => cnName(d.id)))];
      return names.length > 0 && names.length <= 4 ? `卡名为『${names.join("』或『")}』` : `名字含『${f.v}』`;
    }
    case "defs":
      return `卡名为『${[...new Set(f.v.map(cnName))].join("』或『")}』`;
    case "costMin":
      return `费用≥${f.v}`;
    case "costMax":
      return `费用≤${f.v}`;
    case "atkMin":
      return `攻击力≥${f.v}`;
    case "atkMax":
      return `攻击力≤${f.v}`;
    case "defMin":
      return `生命值≥${f.v}`;
    case "defMax":
      return `生命值≤${f.v}`;
    case "evolved":
      return "已进化";
    case "unevolved":
      return "未进化";
    case "token":
      return "衍生物";
    case "notSelf":
      return "不是这张卡自己";
    case "racing":
      return "已起跑";
    case "engaged":
      return "横置";
    case "other":
      return `（读不懂的条件：${UNREAD[f.why] ?? f.why}）`;
    case "and": {
      // 费用≥2 且 费用≤2 → 费用=2 (and the same for attack and defense).
      const args = f.args.filter((a, k) => f.args.findIndex((b) => JSON.stringify(b) === JSON.stringify(a)) === k);
      const parts: string[] = [];
      for (const [min, max, label] of [["costMin", "costMax", "费用"], ["atkMin", "atkMax", "攻击力"], ["defMin", "defMax", "生命值"]] as const) {
        const lo = args.find((a) => a.t === min) as { v: number } | undefined;
        const hi = args.find((a) => a.t === max) as { v: number } | undefined;
        if (lo && hi && lo.v === hi.v) {
          parts.push(`${label}=${lo.v}`);
          args.splice(args.indexOf(lo as RefFilter), 1);
          args.splice(args.indexOf(hi as RefFilter), 1);
        }
      }
      // "Not this card itself" last, as a remark.
      const self = args.some((a) => a.t === "notSelf");
      const text = [...args.filter((a) => a.t !== "notSelf").map(filterText), ...parts].join(" 且 ");
      return self ? `${text}（不含这张卡自己）` : text;
    }
    case "or":
      return `（${f.args.map(filterText).join(" 或 ")}）`;
    case "not":
      return f.arg.t === "engaged" ? "竖置" : `不是（${filterText(f.arg)}）`;
  }
}

/** A player's choice a reference is under (CardRef.alt), in words: the play option's cost, the mode's number... */
function altText(token: string, def: string, costLine = false): string {
  const not = token.startsWith("!");
  const [kind, id = ""] = (not ? token.slice(1) : token).split(/:(.*)/s);
  const script = ALL_SCRIPTS[def];
  switch (kind) {
    case "opt": {
      const options = script?.playOptions ?? [];
      const o = options.find((x) => x.id === id);
      const k = options.indexOf(o!) + 1;
      const way =
        options.length > 1 || !o
          ? `用第 ${Math.max(k, 1)} 种方式`
          : o.costDelta && o.costDelta > 0
            ? `将消费 +${o.costDelta}`
            : o.costDelta && o.costDelta < 0
              ? `将消费 −${-o.costDelta}`
              : o.setCost !== undefined
                ? `以消费 ${o.setCost}`
                : o.earthRite !== undefined
                  ? "以土之秘术"
                  : "支付追加费用";
      // On its own cost's line: whether this way of using the card is open at all.
      const sp = /\d$/.test(way) ? " " : "";
      if (costLine) return `${way}${sp}使用的费用`;
      return not ? `没${way}${sp}时` : `${way}${sp}使用时`;
    }
    case "mode":
      return `抉择【${id}】时`;
    case "pick":
    case "opp.pick":
      return `${kind === "opp.pick" ? "对方" : ""}${not ? "没选" : "选了"}「${id}」时`;
    case "may":
      return not ? "不执行时" : "执行时";
    case "opp.may":
      return not ? "对方不执行时" : "对方执行时";
    case "pay":
      return not ? "没支付费用时" : "支付了费用时";
    case "rite":
      return not ? "没支付土之秘术时" : "支付了土之秘术时";
    case "mem":
      return not ? `付费时没选「${id}」` : `付费时选了「${id}」`;
    default:
      return token;
  }
}

/** A reference's test (CardRef.test) in words: the count it needs and what it does with it. */
const ROLE: Record<string, string> = { gate: "门槛", branch: "分支", bonus: "额外" };
function testText(r: CardRef): string | null {
  const t = r.test;
  if (!t) return null;
  // "At least n" as a gate reads as version 2 did; the other comparisons and roles are written out.
  if (t.kind === "atLeast" && t.role === "gate") return t.n === 1 ? "有没有" : `张数 ≥${t.n}`;
  const n = t.kind === "atLeast" ? (t.n === 1 ? "有" : `张数 ≥${t.n}`) : t.kind === "atMost" ? (t.n === 0 ? "没有" : `张数 ≤${t.n}`) : t.kind === "exactly" ? `张数 =${t.n}` : `张数 ≠${t.n}`;
  return `${n}（${ROLE[t.role]}）`;
}

/** Where a reference's ability works, when that is not only the field (CardRef.from); played cards' abilities say nothing. */
function fromText(r: CardRef): string {
  if (["fanfare", "spell", "fromHand"].includes(r.timing) || (r.from.length === 1 && r.from[0] === "field")) return "";
  if (r.from.length >= 10) return "（在任何区域都起作用）";
  const ZONE_FROM: Record<string, string> = { ...ZONE, equipmentZone: "装备区" };
  return `（在${r.from.map((z) => ZONE_FROM[z] ?? z).join("、")}起作用）`;
}

/** A reference in words. */
function refText(r: CardRef, def: string): string {
  const zones = r.zones.map((z) => (z === "deck" && r.top ? `牌组顶 ${r.top} 张` : (ZONE[z] ?? z))).join("、");
  const cards = r.filter.t === "any" ? "的任何卡" : `「${filterText(r.filter)}」的卡`;
  const what = `${SIDE[r.side]}${zones}里${cards}${r.distinct ? "（卡名各不相同）" : ""}`;
  // "费用能不能支付" already says it is about paying; a play option on its own cost line says whose cost it is.
  const costLine = r.where === "canPay" || r.where === "pay";
  const alts = (r.alt ?? []).filter((t) => !(costLine && t === "pay")).map((t) => altText(t, def, costLine && t.startsWith("opt:")));
  if (r.chance) alts.push("**靠运气**");
  const when = alts.length > 0 ? `（${alts.join("、")}）` : "";
  const where = r.chance === "top" && r.where === "search" ? "查看牌组顶部" : (WHERE[r.where] ?? r.where);
  const place = `${TIMING[r.timing] ?? r.timing} · ${where}${when}${fromText(r)}`;
  if (r.chance === "top") return `${place}：${SIDE[r.side]}牌组顶部 ${r.top ?? "几"} 张里有${cards}的机会${refPartial(r.filter) ? "（**有读不懂的部分**）" : ""}`;
  if (r.chance === "random") return `${place}：随机的结果，按均匀概率算${refPartial(r.filter) ? "（**有读不懂的部分**）" : ""}`;
  const how = r.scaled ? "张数 → 按数量起作用" : (testText(r) ?? (r.agg === "exists" ? "有没有" : "张数"));
  return `${place}：${what}，${how}${refPartial(r.filter) ? "（**有读不懂的部分**）" : ""}`;
}

// The check against the engine: recorded games if there are, else generated ones.
const recorded = ["stage1-v1", "stage1-holdout-v1"].map((r) => join(ROOT, "..", "rl-runs", r, "games.jsonl.gz")).filter(existsSync);
function* positions(): Generator<GameSession> {
  if (recorded.length > 0) {
    for (const file of recorded) {
      let n = 0;
      for (const line of gameLines(file)) {
        if (n++ >= games) break;
        const g = JSON.parse(line);
        const game = engine.newGame({ seed: g.seed, players: [g.decks[0].deck, g.decks[1].deck], config: g.config });
        for (const [, input] of g.inputs) {
          if (game.decision?.type === "mainPhase") yield game;
          game.act(input);
        }
      }
    }
    return;
  }
  const names = [...DECK_SETS.train, ...DECK_SETS.holdout];
  for (const [i, name] of names.entries()) {
    const game = engine.newGame({ seed: `review-${name}`, players: [sampleDeck(name)!.deck, sampleDeck(names[(i + 5) % names.length]!)!.deck], config: { deckRestrictions: false } });
    const rng = seedRng(`review-${name}:answers`);
    for (let step = 0; game.decision && step < 3000; step++) {
      if (game.decision.type === "mainPhase") yield game;
      game.act(randomAnswer(rng, game.decision));
    }
  }
}
const oracle = checkReferences(positions(), (def) => analyses.get(def)?.refs, ALL_SCRIPTS);

// The decks' cards, each listed once under the first deck it is in.
const decks = [...DECK_SETS.train, ...DECK_SETS.holdout];
const where = new Map<string, string[]>();
for (const name of decks) {
  const d = sampleDeck(name)!.deck;
  for (const p of [...d.main, ...d.evolve]) {
    const def = engine.db.ofPrinting(p).id;
    const list = where.get(def) ?? [];
    if (!list.includes(name)) list.push(name);
    where.set(def, list);
  }
}
const lines: string[] = [];
let flagged = 0;
let partialCards = 0;
let withRefs = 0;
const classNames = Object.values(CLASS);
for (const name of decks) {
  const defs = [...where].filter(([, ds]) => ds[0] === name).map(([def]) => def).sort();
  lines.push(`## ${name}${DECK_SETS.holdout.includes(name) ? "（测试卡组）" : ""}`, "");
  for (const def of defs) {
    const d = engine.db.get(def);
    const a = analyses.get(def);
    const text = (d.text.cn ?? d.text.en ?? "").replace(/\s*\n\s*/g, " ");
    lines.push(`### ${cnName(def)}（${def}）— ${CLASS[d.class] ?? d.class} · ${TYPE[d.type] ?? d.type}${d.cost !== null ? ` · ${d.cost} 费` : ""}${where.get(def)!.length > 1 ? ` · 也在 ${where.get(def)!.slice(1).join("、")}` : ""}`);
    lines.push(`卡面：${text || "（没有卡面文本）"}`);
    if (!a) {
      lines.push("AI 读到的：没有脚本。", "");
      continue;
    }
    const families = Object.entries(a.fx).filter(([, n]) => n > 0).map(([f, n]) => `${FAMILY[f] ?? f}${n > 1 ? ` ×${n}` : ""}`);
    const AMOUNT: Record<string, string> = { dmg: "伤害", aoe: "全体伤害", stats: "加攻击力 / 生命值", debuff: "减攻击力 / 生命值", heal: "主战者生命", draw: "抽牌", mill: "牌组送墓", ex: "进额外区", summon: "召唤", pp: "PP" };
    const amounts = Object.entries(a.amounts).filter(([, n]) => n > 0).map(([k, n]) => `${AMOUNT[k] ?? k} ${n}`);
    const COND: Record<string, string> = { overflow: "觉醒（溢出）", necrocharge: "死灵术", spellchain: "魔力连锁", combo: "连击", sanguine: "渴血" };
    const conds = Object.entries(a.conds).filter(([, n]) => n > 0).map(([c, n]) => (c === "overflow" || c === "sanguine" ? COND[c] : `${COND[c]} ${n}`));
    lines.push(`- 效果：${families.join("、") || "无"}${amounts.length ? `（写明的数值：${amounts.join("、")}）` : ""}${conds.length ? `；条件用到：${conds.join("、")}` : ""}`);
    if (a.refs.length === 0) lines.push("- 数的东西：无");
    else {
      withRefs += 1;
      if (a.refs.some((r) => refPartial(r.filter as RefFilter))) partialCards += 1;
      lines.push("- 数的东西：");
      for (const r of a.refs) {
        const key = `${def} ${r.where}${r.ability >= 0 ? `#${r.ability}` : ""}`;
        const check = oracle.byClosure.get(key);
        const checked = check ? (check.disagree === 0 ? `（和引擎对过 ${check.agree} 次，一致）` : `（**和引擎不一致** ${check.disagree} 次：${check.examples[0]}）`) : "";
        const ref: CardRef = { ...r, filter: r.filter as RefFilter, test: r.test ?? null, from: refFrom(d, ALL_SCRIPTS[def]!, r) };
        lines.push(`  - ${refText(ref, def)}${checked}`);
      }
    }
    // The text counts cards of a cemetery, a trait or a class that no reference covers: maybe something the analysis missed.
    // Read without the tokens' descriptions (after the rule line), sentence by sentence; a count is "…以上", "每有", "张数".
    const own = text.split(/―{3,}/)[0]!;
    const sentences = own.split(/[。；]/);
    const counting = (s: string) => /以上|每有|张数|个数|数量/.test(s);
    const covered = JSON.stringify(a.refs);
    const mentioned: string[] = [];
    if (sentences.some((s) => /墓场(中|里|内)/.test(s) && counting(s)) && !a.refs.some((r) => r.zones.includes("cemetery")) && !a.conds.spellchain && !a.conds.necrocharge) mentioned.push("墓场里的张数");
    const found = [...new Set(Object.keys(TRAIT_NAMES).filter((t) => sentences.some((s) => s.includes(`${trait(t)}类型`) && counting(s))))];
    // A trait whose name is part of a longer one found too (龙人 in 武斗龙人) is that longer one.
    const traitsOfText = found.filter((t) => !found.some((u) => u !== t && trait(u).includes(trait(t))));
    for (const t of traitsOfText) if (!covered.includes(t)) mentioned.push(`「${trait(t)}」类型的张数`);
    for (const [en, cn] of Object.entries(CLASS)) if (sentences.some((s) => s.includes(`${cn}职业`) && counting(s)) && !covered.includes(en)) mentioned.push(`${cn}职业的张数`);
    if (mentioned.length > 0) {
      flagged += 1;
      lines.push(`- **请看一下**：卡面数了 ${mentioned.join("、")}，但上面没有对应的计数（可能漏了）。`);
    }
    lines.push("");
  }
}
const head = [
  "# 卡牌特征表 v3 审查表",
  "",
  `由 \`npm run rl:review\` 生成（${new Date().toISOString().slice(0, 10)}）。列出 ${DECK_SETS.train.length + DECK_SETS.holdout.length} 套示例卡组的 ${where.size} 张卡（每张只列在它出现的第一套卡组下），每张卡：卡面、AI 从脚本里读到的效果类别，以及它"在数什么"。表有 ${CARD_FEATURE_COLUMNS.length} 列。`,
  "",
  "怎么看：",
  "- **数的东西**：卡的效果或条件要数的卡，写成「时机 · 用在哪：哪一方的哪个区域里的什么卡，张数 / 有没有」。「按数量起作用」= 张数直接决定效果大小（例如能消失几个）；「张数 ≥3」= 至少要 3 张效果才发生；「没有（门槛）」= 一张都没有才发生（例如「如果没有其他从者」），「张数 ≤2（门槛）」「张数 =5（门槛）」同理；（分支）= 张数决定走两种效果中的哪一种；（额外）= 效果照常发生，张数够了再多做一点；「要选择的对象 / 从牌组寻找：有没有」= 有没有能选、能找到的卡；「对选中的卡的条件：有没有」= 效果对某种卡更强（例如目标是龙裔就改成 5 点伤害），对方场上有没有这种卡。",
  "- **（在…起作用）**：能力不在战场上起作用时，写出它在哪里起作用（例如在手牌里就能启动的能力、墓场里的能力、额外区的纹章）；入场曲和法术不写（它们在使用时起作用）。",
  "- **括号里的（…时）**：这个计数只在玩家这样选的时候才用到；「没…时」是没这样选的时候。使用时选的：将消费 +N / −N 或用别的方式使用（CR 10.4.7.3）、抉择【n】（有的卡可以选不止一项）、土之秘术、追加费用（CR 10.6.2.2.2）。「支付了费用时」：入场曲等能力自己的可选费用（「费用：效果」，CR 10.4.7.4）或抉择项的费用（CR 10.4.7.5），要付了才有后面的效果。「执行时」：处理中问「要不要执行」的效果。「最多选 N 张 / 可以将 1 张……加入手牌」这种选择不单独标。费用那一行的（……使用的费用）是说这是哪种使用方式的费用：付不起就不能这样使用。",
  "- **靠运气**：要用到牌组顶部的卡，谁都不知道顺序（CR 4.5.2；之前的效果让自己看过的除外），处理前没法确定。公平的 AI 按自己牌组里剩下的卡算概率（对方的牌组：按对方还没出现的卡），只有作弊的 AI 看得到。「查看牌组顶部」= 看顶部几张、从中找（找不到就算了）；「牌组顶的卡」= 对放出去的那张卡有「如果是……的话」（例如 BP10-054：原始消费 5 及以上才进化或回手）。",
  `- **和引擎对过**：用${recorded.length > 0 ? `已录对局（每份数据 ${games} 局）` : "生成的对局"}的每个主要阶段，直接调用卡自己的条件函数，和这里写的数比较。一共调用 ${oracle.calls} 次。只有一个条件函数里正好一处计数的才能这样对；效果处理中间的计数没法直接调用，只能靠人看。`,
  "- **请看一下**：卡面提到墓场、类型或职业，但没有提取到对应计数，可能漏了。",
  "- 请重点找：数错的区域或哪一方、漏掉的条件（类型、职业、费用）、门槛数字不对、该按数量的没标、该数的没数。",
  "",
  `概况：${withRefs} 张卡有计数，其中 ${partialCards} 张有读不懂的部分；${flagged} 张标了"请看一下"；和引擎对照的 ${oracle.byClosure.size} 个条件函数里，不一致的 ${[...oracle.byClosure.values()].filter((v) => v.disagree > 0).length} 个。`,
  "",
];
const out = join(ROOT, "docs", "card-table-review.md");
mkdirSync(join(ROOT, "docs"), { recursive: true });
// The lines that changed since the file there, under their card (the head and the counts of checks aside).
const sections = (text: string) => {
  const m = new Map<string, string[]>();
  let card = "";
  for (const l of text.split("\n")) {
    if (l.startsWith("### ")) card = l;
    else if (card && l.startsWith("  - ")) m.set(card, [...(m.get(card) ?? []), l.replace(/（和引擎对过 \d+ 次，一致）$/, "")]);
  }
  return m;
};
const before = existsSync(out) ? sections(readFileSync(out, "utf8").replace(/\r\n/g, "\n")) : null;
writeFileSync(out, [...head, ...lines].join("\n"), "utf8");
if (before) {
  const now = sections([...head, ...lines].join("\n"));
  let changed = 0;
  for (const card of new Set([...before.keys(), ...now.keys()])) {
    const a = before.get(card) ?? [];
    const b = now.get(card) ?? [];
    const gone = a.filter((l) => !b.includes(l));
    const added = b.filter((l) => !a.includes(l));
    if (gone.length === 0 && added.length === 0) continue;
    changed += 1;
    console.log(card);
    for (const l of gone) console.log(`  - ${l.slice(4)}`);
    for (const l of added) console.log(`  + ${l.slice(4)}`);
  }
  console.log(`${changed} cards with changed lines since the last review file`);
}
console.log(`${where.size} cards, ${withRefs} counting something (${partialCards} partly unread), ${flagged} flagged; oracle ${oracle.calls} calls over ${oracle.byClosure.size} closures -> ${out}`);
