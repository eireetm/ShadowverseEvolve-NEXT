// The cemetery window's stats, folded out under its title by the button beside "close": how many cards of each cost, class,
// card type and trait (cemetery-stats.ts), and how many in all at the top right.
import type { CardType, CardView } from "@sve/core";
import type { ReactNode } from "react";
import { useSettings } from "../../app/settings";
import { useApp } from "../../app/store";
import { traitName } from "../../app/traits";
import { htmlLang, useT } from "../../i18n";
import { cemeteryStats } from "./cemetery-stats";

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </>
  );
}

export function CemeteryStats({ cards }: { cards: readonly CardView[] }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const { cardLang } = useSettings();
  if (!catalog) return null;
  const stats = cemeteryStats(cards, catalog);
  const count = (n: number) => <strong>{t("game.cemeteryStats.n", { n })}</strong>;
  const type = (key: CardType) => t(`type.${key}` as const);
  return (
    <section className="sve-zone-stats" data-testid="zone-stats">
      <dl>
        <Row label={t("builder.cost")} testId="zone-stats-cost">
          {stats.costs.map(({ key, n }) => (
            <span key={String(key)} className="sve-zone-stats-item">
              {key === null ? t("game.cemeteryStats.noCost") : t("game.cemeteryStats.costN", { cost: key })} {count(n)}
            </span>
          ))}
        </Row>
        <Row label={t("builder.class")} testId="zone-stats-class">
          {stats.classes.map(({ key, n }) => (
            <span key={key} className="sve-zone-stats-item">
              {t(`class.${key}` as const)} {count(n)}
            </span>
          ))}
        </Row>
        <Row label={t("builder.type")} testId="zone-stats-type">
          {stats.types.map(({ key, n }) => (
            <span key={key} className="sve-zone-stats-item">
              {type(key)} {count(n)}
            </span>
          ))}
        </Row>
        <Row label={t("card.traits")} testId="zone-stats-traits">
          {stats.traits.map(({ key, n, types }) => (
            <span key={key} className="sve-zone-stats-item sve-zone-stats-trait">
              <span lang={htmlLang(cardLang)}>{traitName(key, cardLang)}</span> {count(n)}
              <span className="sve-zone-stats-parts">
                {t("game.cemeteryStats.parts", {
                  parts: types.map((part) => t("game.cemeteryStats.part", { n: part.n, type: type(part.key) })).join(t("game.cemeteryStats.separator")),
                })}
              </span>
            </span>
          ))}
        </Row>
      </dl>
      <div className="sve-zone-stats-total" data-testid="zone-stats-total">
        {t("game.cemeteryStats.total", { n: stats.total })}
      </div>
    </section>
  );
}
