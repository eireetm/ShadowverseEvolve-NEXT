import { describe } from "vitest";
import { setSmokeTests } from "./set-smoke";

// CP05 (Granblue Fantasy) is a pre-release set (data/preview.ts): its cards have their Japanese names. Every treasure (CP05-T09
// … T15, used from the EX area) can select the 全属性 Granblue follower with Final Uncap on the player's field (CP05-110: an
// element's attribute references 全属性, CR JP 14.6.2.2). It starts not uncapped, so an element (T10 … T14) uncaps it and
// ヒヒイロカネ (T15) uncaps and final-uncaps it (CR JP 14.6.4); for CP05-T09 it starts uncapped (by another fire element), so
// that element final-uncaps it instead (CR JP 14.6.4.2). CP05-031 evolves (into CP05-032) only with 4 faceup earth evolved
// followers in the evolve deck (CP05-109 is 全属性, so it counts too: CR JP 14.6.2.2); CP05-083's additional cost discards a
// dark card from the hand (CR 10.1.1.4).
describe("CP05 whole set", () => {
  setSmokeTests("CP05", {
    games: 40,
    extras: {
      field: ["CP05-110"],
      perCard: {
        "CP05-032": { faceUpEvolveDeck: ["CP05-032", "CP05-046", "CP05-092", "CP05-109"] },
        "CP05-083": { hand: ["CP05-083", "CP05-076"] },
        "CP05-T09": { field: [{ card: "CP05-110", uncappedWith: [{ card: "CP05-T09", uncaps: ["uncap"] }] }] },
      },
    },
  });
});
