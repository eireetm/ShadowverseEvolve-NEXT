import { describe } from "vitest";
import { setSmokeTests } from "./set-smoke";

describe("BP01 whole set", () => {
  setSmokeTests("BP01", { games: 40 });
});
