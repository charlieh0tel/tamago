// The reflector spacing field is authored as the clearance under the lower loop
// -- what a builder can measure -- while the spec stores the loop-center height.
// These check the conversion both ways, since a one-sided error would silently
// move every reflector the user places.

import { describe, expect, it } from "vitest";
import { clearanceWlForSpec, spacingWlForClearance } from "../src/app/state/uiSpec";
import { roundConductor } from "../src/engine/conductor";
import { REFLECTOR_RADIALS } from "../src/engine/constants";
import { SHAPE_SQUIRCLE } from "../src/engine/geometry";
import { makeDesignSpec } from "../src/engine/spec";

const PERIMETER_MM = 2180.3;

function spec(overrides: Record<string, unknown> = {}) {
  return makeDesignSpec(145.9, roundConductor(5.0), {
    reflector: REFLECTOR_RADIALS,
    reflectorSpacingWl: 0.188,
    ...overrides,
  });
}

describe("reflector clearance conversion", () => {
  it("round-trips the stored loop-center height", () => {
    const s = spec();
    const clearance = clearanceWlForSpec(s, PERIMETER_MM);
    expect(spacingWlForClearance(s, PERIMETER_MM, clearance)).toBeCloseTo(0.188, 12);
  });

  it("sits a loop radius below the center height", () => {
    // A 2180 mm circle is about 694 mm across, so its bottom hangs some 347 mm
    // (0.169 wl at 2 m) under the center: the clearance is far smaller than the
    // height, which is the whole reason for reporting it.
    const clearance = clearanceWlForSpec(spec(), PERIMETER_MM);
    expect(clearance).toBeGreaterThan(0.0);
    expect(clearance).toBeLessThan(0.188 / 5);
  });

  it("accounts for the shape's own extent", () => {
    // At equal perimeter a square is narrower across than a circle, so its
    // bottom hangs less far down and the same height leaves more clearance.
    const circle = clearanceWlForSpec(spec(), PERIMETER_MM);
    const squircle = clearanceWlForSpec(
      spec({ loopShape: SHAPE_SQUIRCLE, cornerRadiusWl: 0.05 }),
      PERIMETER_MM,
    );
    expect(squircle).not.toBeCloseTo(circle, 4);
  });
});
