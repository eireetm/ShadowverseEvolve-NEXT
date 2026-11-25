import { describe } from "vitest";
import { setSmokeTests } from "./set-smoke";

// CP05 (Granblue Fantasy) is a pre-release set (data/preview.ts): its cards have their Japanese names. A 全属性 follower with
// Final Uncap on the player's field (CP05-110) lets every treasure (CP05-T09 … T15, played from the EX area) uncap and
// final-uncap something (CR JP 14.6.2.2, JP 14.6.4). CP05-031 evolves (into CP05-032) only with 4 faceup earth evolved
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
      },
    },
  });
});
