// The progress bar's denominator. These expectations are the calibration: they
// are checked against real nec2c run counts (see estimatedOptimizeRuns), so a
// change to the search constants that invalidates the scale fails here rather
// than silently making the bar wrong again.

import { describe, expect, it } from "vitest";
import { estimatedOptimizeRuns } from "../src/app/worker/progressScale";
import { roundConductor } from "../src/engine/conductor";
import {
  REFLECTOR_GROUND,
  REFLECTOR_NONE,
  REFLECTOR_RADIALS,
} from "../src/engine/constants";
import { makeDesignSpec } from "../src/engine/spec";

function runsFor(reflector: string): number {
  return estimatedOptimizeRuns(
    makeDesignSpec(145.9, roundConductor(5.0), { reflector }),
  );
}

describe("estimated optimize runs", () => {
  it("scales with the free axes of the placement search", () => {
    // A radial search adds the droop axis and four radial counts, so it costs
    // about eight times a ground search.
    expect(runsFor(REFLECTOR_RADIALS)).toBeGreaterThan(7 * runsFor(REFLECTOR_GROUND));
  });

  it("stays within a quarter of the measured run counts", () => {
    // Measured: 1026-1058 runs for radials, 117 for ground.
    expect(runsFor(REFLECTOR_RADIALS)).toBeGreaterThan(1026 * 0.75);
    expect(runsFor(REFLECTOR_RADIALS)).toBeLessThan(1058 * 1.25);
    expect(runsFor(REFLECTOR_GROUND)).toBeGreaterThan(117 * 0.75);
    expect(runsFor(REFLECTOR_GROUND)).toBeLessThan(117 * 1.25);
  });

  it("costs one perimeter tune with no reflector to place", () => {
    expect(runsFor(REFLECTOR_NONE)).toBeLessThan(runsFor(REFLECTOR_GROUND));
  });
});
