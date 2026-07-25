import { describe, expect, it } from "vitest";
import {
  CIRCLE_GMD_FACTOR,
  RECT_GMD_FACTOR,
  STRIP_EQUIV_RADIUS_FACTOR,
  barConductor,
  equivalentRadiusM,
  roundConductor,
  stripConductor,
} from "../src/engine/conductor";

// Ported from tests/test_conductor.py.
describe("conductor", () => {
  it("round radius is half diameter", () => {
    const c = roundConductor(3.0);
    expect(c.equivalentRadiusMm).toBe(1.5);
    expect(equivalentRadiusM(c)).toBe(0.0015);
  });

  it("strip radius is quarter width", () => {
    const c = stripConductor(12.0);
    expect(c.equivalentRadiusMm).toBe(STRIP_EQUIV_RADIUS_FACTOR * 12.0);
  });

  it("bar zero thickness degenerates to strip", () => {
    expect(barConductor(10.0, 0.0).equivalentRadiusMm).toBe(
      stripConductor(10.0).equivalentRadiusMm,
    );
  });

  it("bar uses gmd formula", () => {
    const c = barConductor(12.0, 3.0);
    const expected = (RECT_GMD_FACTOR * (12.0 + 3.0)) / CIRCLE_GMD_FACTOR;
    expect(c.equivalentRadiusMm).toBeCloseTo(expected, 12);
  });
});
