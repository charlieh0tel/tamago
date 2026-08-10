// Ported from the retired Python test_cli.py: the derived loop mesh. Pure arithmetic on the
// spec, so no nec2c.

import { describe, expect, it } from "vitest";
import { roundConductor, stripConductor } from "../src/engine/conductor";
import { MIN_LOOP_SEGMENTS } from "../src/engine/constants";
import { loopSegments } from "../src/engine/design";
import { makeDesignSpec } from "../src/engine/spec";

function sides(shape: string, extra: Record<string, unknown> = {}): number {
  return loopSegments(
    makeDesignSpec(145.9, roundConductor(5.0), {
      loopShape: shape,
      segments: null,
      ...extra,
    }),
  );
}

describe("derived loop mesh", () => {
  it("passes an explicit count through untouched", () => {
    expect(
      loopSegments(makeDesignSpec(145.9, roundConductor(5.0), { segments: 36 })),
    ).toBe(36);
  });

  it("needs more sides the more curved the outline is", () => {
    // A square's straight sides are exact at any multiple of the quantum, so only
    // the conductor-radius target applies; a circle has to track a curve; and a
    // squircle needs the most, because its curvature is concentrated in four tight
    // corners while segments are spread evenly along the perimeter.
    expect(sides("square")).toBe(24);
    expect(sides("circle")).toBe(28);
    expect(sides("squircle", { cornerRadiusWl: 0.05 })).toBe(48);
    expect(sides("square")).toBeLessThan(sides("circle"));
    expect(sides("circle")).toBeLessThan(sides("squircle", { cornerRadiusWl: 0.05 }));
  });

  it("holds the segment length per conductor radius across bands", () => {
    // The published 2 m reference conductor (10 mm flat rod) and a plain 5 mm
    // round have the same equivalent radius, so they derive the same count.
    expect(
      loopSegments(
        makeDesignSpec(145.0, stripConductor(10.0), {
          loopShape: "circle",
          segments: null,
        }),
      ),
    ).toBe(28);
  });

  it("never goes below the polygon floor, however thick the conductor", () => {
    expect(sides("square", { conductor: roundConductor(40.0) })).toBe(
      MIN_LOOP_SEGMENTS,
    );
  });
});
