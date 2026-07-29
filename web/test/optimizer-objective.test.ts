// Ported from tests/test_cli.py: the reflector optimizer scores axial ratio by
// the worst point over the coverage cone (not the mean) and picks the radial
// count at the diminishing-returns knee. Pure helpers, so no nec2c.

import { describe, expect, it } from "vitest";
import { roundConductor } from "../src/engine/conductor";
import { type DesignResult, kneeCount, reflectorCost } from "../src/engine/design";
import { makeDesignSpec } from "../src/engine/spec";

function coneResult(worst: number, mean: number): DesignResult {
  const spec = makeDesignSpec(145.9, roundConductor(5.0), {
    reflector: "radials",
    arMarginDb: 0.5,
  });
  return {
    spec,
    baseFactor: 1.05,
    zIn: { re: 50.0, im: 0.0 },
    phaseDiffDeg: 90.0,
    loopBalance: 1.0,
    crossedPhasingLine: false,
    sense: "RIGHT",
    arBoresightDb: mean,
    arConeWorstDb: worst,
    arPeakDb: 0.5,
    coverageGainDb: 0.0,
    deck: "",
    loopAFeedZ: null,
    loopBFeedZ: null,
  };
}

describe("reflector optimizer objective", () => {
  it("scores placement by the worst cone AR, not the cone mean", () => {
    // Mean identical; only the worst-case cone AR differs, so it alone drives
    // the placement cost.
    expect(reflectorCost(coneResult(4.0, 1.0))).toBeGreaterThan(
      reflectorCost(coneResult(2.0, 1.0)),
    );
  });

  it("picks the radial count at the diminishing-returns knee", () => {
    const counts = [3, 4, 6, 8];
    // 0.43 dB step (3->4) is worth it; 0.12 dB step (4->6) is not: keep 4.
    expect(kneeCount(counts, { 3: 3.2, 4: 2.77, 6: 2.65, 8: 2.66 })).toBe(4);
    // Flat from the start: fewest count wins.
    expect(kneeCount(counts, { 3: 2.59, 4: 2.5, 6: 2.45, 8: 2.5 })).toBe(3);
    // Every step still buys >= AR_KNEE_DB: walk to the largest.
    expect(kneeCount(counts, { 3: 5.0, 4: 4.5, 6: 4.0, 8: 3.5 })).toBe(8);
    // A marginal count at the budget loses to the next with real headroom.
    expect(kneeCount(counts, { 3: 3.0, 4: 2.67, 6: 2.6, 8: 2.59 })).toBe(4);
    // A single count (e.g. a ground reflector) is returned as-is.
    expect(kneeCount([4], { 4: 3.5 })).toBe(4);
  });
});
