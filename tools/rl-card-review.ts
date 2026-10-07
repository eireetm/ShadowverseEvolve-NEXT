/**
 * The card feature table's review list, in Chinese, for a person: npm run rl:review [-- --games N]
 * For every card of the sample decks (the training and test decks): its Chinese text, the effects the table says it has (by
 * family), and what it counts (tools/rl/script-analysis.ts) written out in words — the zone, whose, which cards, a threshold
 * or a quantity, in which ability — with the check against the engine (tools/rl/ref-oracle.ts, on recorded games when the run
 * folders are there, else on generated ones) and marks where the text speaks of a cemetery, a trait or a class that no
 * reference covers. Writes docs/card-table-review.md (a local note; nothing in the repository reads it).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_FEATURE_COLUMNS, refNeeded, refPartial, type CardRef, type RefFilter } from "../packages/bot/src";
import { createEngine, randomAnswer, seedRng, type GameSession } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { TRAIT_NAMES } from "../packages/gui/src/app/traits";
import { checkReferences } from "./rl/ref-oracle";
import { gameLines } from "./rl/records";
import { analyzeScripts } from "./rl/script-analysis";
import { DECK_SETS, ROOT, sampleDeck } from "./rl/series";

const args = process.argv.slice(2);
const games = Number(args[args.indexOf("--games") + 1] ?? 300) || 300;
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const analyses = analyzeScripts(ALL_SCRIPTS);

const ZONE: Record<string, string> = { field: "战场", cemetery: "墓场", hand: "手牌", deck: "牌组", ex: "额外区", evolveDeck: "进化牌组", banished: "消失领域", evolveZone: "进化区", leader: "主战者", other: "（某个区域）" };
const SIDE: Record<string, string> = { own: "我方", opp: "对方", both: "双方", "?": "（不确定哪一方）" };
const TIMING: Record<string, string> = {
  fanfare: "入场曲",
  lastWords: "谢幕曲",
  onEvolve: "进化时",
  strike: "攻击时",
  turnStart: "主要阶段开始时",
  turnEnd: "结束阶段开始时",
  otherTrigger: "其他诱发能力",
  activated: "启动能力",
  evolve: "进化能力",
  spell: "法术",
  continuous: "常驻",
  fromHand: "在手牌时（打出的费用 / 条件）",
};
const WHERE: Record<string, string> = {
  condition: "条件",
  triggerIf: "诱发条件",
  max: "选择数量的上限",
  when: "能不能选择",
  target: "要选择的对象",
  search: "检索",
  searchEach: "检索",
  fromEvolveDeck: "从进化牌组选",
  resolve: "效果处理",
  selfKeywords: "自身的关键词",
  keywordsFor: "给予关键词",
  playCost: "打出的费用",
  playCostOf: "其他卡的费用",
  playableIf: "能不能打出",
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

/** A filter in words. */
function filterText(f: RefFilter): string {
  switch (f.t) {
    case "any":
      return "任何卡";
    case "type":
      return TYPE[f.v] ?? f.v;
    case "trait":
      return `「${trait(f.v)}」类型`;
    case "class":
      return `${CLASS[f.v] ?? f.v}职业`;
    case "name":
      return `名为「${cnName(engine.db.all().find((d) => d.name === f.v)?.id ?? "") || f.v}」`;
    case "nameIncludes":
      return `名字含「${f.v}」`;
    case "defs":
      return `卡名为「${[...new Set(f.v.map(cnName))].join("」或「")}」`;
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
      return "（不含这张卡自己）";
    case "other":
      return `（读不懂的条件：${f.why}）`;
    case "and":
      return f.args.map(filterText).join(" 且 ");
    case "or":
      return `（${f.args.map(filterText).join(" 或 ")}）`;
    case "not":
      return `不是（${filterText(f.arg)}）`;
  }
}

/** A reference in words. */
function refText(r: CardRef): string {
  const what = `${SIDE[r.side]}${r.zones.map((z) => ZONE[z] ?? z).join("、")}里「${filterText(r.filter)}」的卡`;
  const need = refNeeded(r);
  const how = r.agg === "exists" ? "有没有" : r.scaled ? "张数 → 按数量起作用" : need !== null ? `张数 ≥${need}` : "张数";
  return `${TIMING[r.timing] ?? r.timing} · ${WHERE[r.where] ?? r.where}：${what}，${how}${refPartial(r.filter) ? "（**有读不懂的部分**）" : ""}`;
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
    const conds = Object.entries(a.conds).filter(([, n]) => n > 0).map(([c]) => ({ overflow: "溢出", necrocharge: "死灵术", spellchain: "连锁", combo: "连击", sanguine: "渴血" })[c] ?? c);
    lines.push(`- 效果：${families.join("、") || "无"}${conds.length ? `；条件用到：${conds.join("、")}` : ""}`);
    if (a.refs.length === 0) lines.push("- 数的东西：无");
    else {
      withRefs += 1;
      if (a.refs.some((r) => refPartial(r.filter as RefFilter))) partialCards += 1;
      lines.push("- 数的东西：");
      for (const r of a.refs) {
        const key = `${def} ${r.where}${r.ability >= 0 ? `#${r.ability}` : ""}`;
        const check = oracle.byClosure.get(key);
        const checked = check ? (check.disagree === 0 ? `（和引擎对过 ${check.agree} 次，一致）` : `（**和引擎不一致** ${check.disagree} 次：${check.examples[0]}）`) : "";
        lines.push(`  - ${refText(r as CardRef)}${checked}`);
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
  "# 卡牌特征表 v2 审查表",
  "",
  `由 \`npm run rl:review\` 生成（${new Date().toISOString().slice(0, 10)}）。列出 18 套示例卡组的 ${where.size} 张卡（每张只列在它出现的第一套卡组下），每张卡：卡面、AI 从脚本里读到的效果类别，以及它"在数什么"。表有 ${CARD_FEATURE_COLUMNS.length} 列。`,
  "",
  "怎么看：",
  "- **数的东西**：卡的效果或条件要数的卡，写成「时机 · 用在哪：哪一方的哪个区域里的什么卡，张数 / 有没有」。「按数量起作用」= 张数直接决定效果大小（例如能消失几个）；「张数 ≥3」= 至少要 3 张；「要选择的对象 / 检索：有没有」= 有没有能选、能检索的卡。",
  `- **和引擎对过**：用 ${recorded.length > 0 ? `已录对局（每份数据 ${games} 局）` : "生成的对局"}的每个主要阶段，直接调用卡自己的条件函数，和这里写的数比较。一共调用 ${oracle.calls} 次。只有一个条件函数里正好一处计数的才能这样对；效果处理中间的计数没法直接调用，只能靠人看。`,
  "- **请看一下**：卡面提到墓场、类型或职业，但没有提取到对应计数，可能漏了。",
  "- 请重点找：数错的区域或哪一方、漏掉的条件（类型、职业、费用）、门槛数字不对、该按数量的没标、该数的没数。",
  "",
  `概况：${withRefs} 张卡有计数，其中 ${partialCards} 张有读不懂的部分；${flagged} 张标了"请看一下"；和引擎对照的 ${oracle.byClosure.size} 个条件函数里，不一致的 ${[...oracle.byClosure.values()].filter((v) => v.disagree > 0).length} 个。`,
  "",
];
const out = join(ROOT, "docs", "card-table-review.md");
mkdirSync(join(ROOT, "docs"), { recursive: true });
writeFileSync(out, [...head, ...lines].join("\n"), "utf8");
console.log(`${where.size} cards, ${withRefs} counting something (${partialCards} partly unread), ${flagged} flagged; oracle ${oracle.calls} calls over ${oracle.byClosure.size} closures -> ${out}`);
