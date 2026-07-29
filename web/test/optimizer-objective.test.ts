// Ported from tests/test_cli.py::test_optimizer_objective_uses_worst_cone_ar.
// The reflector optimizer scores axial ratio by the worst point over the
// coverage cone, not the cone mean. Hand-built DesignResults, so no nec2c.

import { describe, expect, it } from "vitest";
import { roundConductor } from "../src/engine/conductor";
import {
  type DesignResult,
  reflectorCost,
  reflectorFeasible,
} from "../src/engine/design";
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
  it("uses the worst cone AR, not the cone mean", () => {
    // Budget is AR_TARGET_DB - margin = 2.5 dB; the mean is under budget in
    // both, so only the worst-case cone AR can drive the outcome.
    const over = coneResult(4.0, 1.0);
    const under = coneResult(2.0, 1.0);
    expect(reflectorFeasible(over)).toBe(false);
    expect(reflectorFeasible(under)).toBe(true);
    expect(reflectorCost(over)).toBeGreaterThan(reflectorCost(under));
  });
});
