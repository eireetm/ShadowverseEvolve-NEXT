import { createEngine } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import { Catalog, cardName, cardText } from "../src/app/catalog";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { newSettingsFile, readSettingsFile } from "../src/app/settings-file";
import { traitName } from "../src/app/traits";
import { quotesOf } from "../src/game/card/gifts";
import { tokenLabel } from "../src/game/card/tokens";
import { scriptLabel } from "../src/game/options";
import { translate } from "../src/i18n";
import { counterName } from "../src/i18n/counters";
import { loadHant, toHant } from "../src/i18n/hant";

// Traditional Chinese (i18n/hant.ts): the interface and the card texts are the Simplified Chinese ones, converted with
// OpenCC's dictionaries (phrases first). Its converter is loaded when it is chosen.

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) })));

describe("Traditional Chinese", () => {
  it("is the Simplified Chinese as it is until its converter is loaded", () => {
    expect(toHant("后手")).toBe("后手");
  });

  it("converts the interface's messages, not what goes into them (a person's name)", async () => {
    await loadHant();
    expect(translate("zh-Hant", "menu.playAi")).toBe("對戰 AI");
    expect(translate("zh-Hant", "menu.settings")).toBe("設置");
    expect(translate("zh-Hant", "card.gained")).toBe("當前獲得能力：");
    expect(translate("zh-Hant", "log.played", { player: "欧丝", card: "预视死期者" })).toBe("欧丝使用了 预视死期者。");
    // Phrases first: one Simplified character can be another Traditional one.
    expect([toHant("后手"), toHant("皇后"), toHant("头发"), toHant("发动"), toHant("一只")]).toEqual(["後手", "皇后", "頭髮", "發動", "一隻"]);
  });

  it("converts the card names and texts, traits, icons, counters, the scripts' options and quoted abilities", async () => {
    await loadHant();
    const gremory = catalog.def("BP12-071")!;
    expect(cardName(gremory, "zh-Hant")).toBe("預視死期者·格莫瑞");
    expect(cardText(gremory, "zh-Hant")).toContain("使這張卡獲得「《謝幕曲》使這張卡消失」能力");
    expect(quotesOf(gremory, "zh-Hant")).toEqual({ lang: "zh-Hant", quotes: ["《謝幕曲》使這張卡消失"] });
    expect(traitName("ギルド管理協会", "zh-Hant")).toBe("公會管理協會");
    expect([tokenLabel("cost03", "zh-Hant"), tokenLabel("fanfare", "zh-Hant")]).toEqual(["消費3", "入場曲"]);
    expect(counterName("stack", "zh-Hant")).toBe("蓄積");
    expect(scriptLabel("Give this follower Storm", { catalog, lang: "zh-Hant" })).toBe("使這張卡獲得【疾馳】能力");
  });

  it("is a value of the settings file's languages", () => {
    const { settings } = readSettingsFile("[language]\ninterface = zh-Hant\ncards = ZH-HANT\n", DEFAULT_SETTINGS);
    expect([settings.uiLang, settings.cardLang]).toEqual(["zh-Hant", "zh-Hant"]);
    expect(newSettingsFile(settings)).toMatch(/^interface = zh-Hant$/m);
    expect(newSettingsFile(settings)).toMatch(/^cards = zh-Hant$/m);
  });
});
