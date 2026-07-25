import { describe, expect, it } from "vitest";
import {
  LOOP_A_TAG_BASE,
  LOOP_B_TAG_BASE,
  type Loop,
  RADIAL_TAG_BASE,
  SHAPE_SQUARE,
  SHAPE_SQUIRCLE,
  loopExtentM,
  loopRadiusM,
  makeEggbeater,
  makeRadials,
  roundedSquareSide,
  wavelengthM,
} from "../src/engine/geometry";

// Python math.isclose: |a-b| <= max(relTol*max(|a|,|b|), absTol).
function isClose(a: number, b: number, relTol = 1e-9, absTol = 0.0): boolean {
  return (
    Math.abs(a - b) <= Math.max(relTol * Math.max(Math.abs(a), Math.abs(b)), absTol)
  );
}

function dist3(p: [number, number, number], q: [number, number, number]): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function loopPerimeter(loop: Loop): number {
  let total = 0.0;
  for (const w of loop.wires) {
    total += dist3([w.x1, w.y1, w.z1], [w.x2, w.y2, w.z2]);
  }
  return total;
}

// Ported from tests/test_geometry.py.
describe("geometry", () => {
  it("wavelength", () => {
    expect(isClose(wavelengthM(299.792458), 1.0)).toBe(true);
  });

  it("loop radius", () => {
    expect(isClose(loopRadiusM(2.0 * Math.PI), 1.0)).toBe(true);
  });

  it("eggbeater wire count and tags", () => {
    const segments = 12;
    const egg = makeEggbeater(1.0, 1.0, 0.5, 0.001, segments);
    expect(egg.loopA.wires.length).toBe(segments);
    expect(egg.loopB.wires.length).toBe(segments);
    expect(egg.loopA.feedTag).toBe(LOOP_A_TAG_BASE);
    expect(egg.loopB.feedTag).toBe(LOOP_B_TAG_BASE);
    const tags = new Set(egg.wires.map((w) => w.tag));
    expect(tags.size).toBe(2 * segments);
  });

  it("feed segment is lowest point", () => {
    const egg = makeEggbeater(1.0, 1.0, 0.5, 0.001, 36);
    const feed = egg.loopA.wires[0]!;
    const midpointZ = (feed.z1 + feed.z2) / 2.0;
    const lowest = Math.min(...egg.loopA.wires.map((w) => Math.min(w.z1, w.z2)));
    expect(isClose(midpointZ, lowest, 1e-9, 1e-9)).toBe(true);
  });

  it("loops lie in perpendicular planes", () => {
    const egg = makeEggbeater(1.0, 1.0, 0.5, 0.001, 12);
    expect(egg.loopA.wires.every((w) => w.y1 === 0.0 && w.y2 === 0.0)).toBe(true);
    expect(egg.loopB.wires.every((w) => w.x1 === 0.0 && w.x2 === 0.0)).toBe(true);
  });

  it("radials share hub and count", () => {
    const radials = makeRadials(8, 0.5, 0.0, 0.0, 0.001, 4);
    expect(radials.length).toBe(8);
    const tags = new Set(radials.map((w) => w.tag));
    const expected = new Set<number>();
    for (let i = 0; i < 8; i++) {
      expected.add(RADIAL_TAG_BASE + i);
    }
    expect(tags).toEqual(expected);
    expect(radials.every((w) => w.x1 === 0.0 && w.y1 === 0.0 && w.z1 === 0.0)).toBe(
      true,
    );
  });

  it("radials horizontal when no droop", () => {
    const radials = makeRadials(4, 0.5, 0.0, 0.0, 0.001, 2);
    expect(radials.every((w) => isClose(w.z2, 0.0, 1e-9, 1e-12))).toBe(true);
    expect(radials.every((w) => isClose(Math.hypot(w.x2, w.y2), 0.5))).toBe(true);
  });

  it("radials droop drops tips", () => {
    const radials = makeRadials(4, 1.0, 0.0, 30.0, 0.001, 2);
    expect(radials.every((w) => isClose(w.z2, -0.5, 1e-9, 1e-9))).toBe(true);
  });

  it("square loop perimeter count and closure", () => {
    const segments = 36;
    const perimeter = 4.0;
    const egg = makeEggbeater(perimeter, perimeter, 1.0, 0.001, segments, SHAPE_SQUARE);
    const loop = egg.loopA;
    expect(loop.wires.length).toBe(segments);
    // 36 divides by 4, so corners land on vertices and the perimeter is exact.
    expect(isClose(loopPerimeter(loop), perimeter, 1e-6)).toBe(true);
    const first = loop.wires[0]!;
    const last = loop.wires[loop.wires.length - 1]!;
    expect(isClose(last.x2, first.x1)).toBe(true);
    expect(isClose(last.z2, first.z1)).toBe(true);
  });

  it("square loop in plane and feed at bottom", () => {
    const egg = makeEggbeater(4.0, 4.0, 1.0, 0.001, 36, SHAPE_SQUARE);
    const loop = egg.loopA;
    expect(loop.wires.every((w) => w.y1 === 0.0 && w.y2 === 0.0)).toBe(true);
    const feed = loop.wires[0]!;
    const feedMidZ = (feed.z1 + feed.z2) / 2.0;
    const lowest = Math.min(...loop.wires.map((w) => Math.min(w.z1, w.z2)));
    expect(isClose(feedMidZ, lowest, 1e-9, 1e-9)).toBe(true);
  });

  it("squircle is rounded square", () => {
    const segments = 72;
    const perimeter = 4.0;
    const radius = 0.2;
    const egg = makeEggbeater(
      perimeter,
      perimeter,
      1.0,
      0.001,
      segments,
      SHAPE_SQUIRCLE,
      radius,
    );
    const loop = egg.loopA;
    expect(loop.wires.length).toBe(segments);
    const half = roundedSquareSide(perimeter, radius) / 2.0;
    const pts = loop.wires.map((w) => [w.x1, w.z1 - 1.0] as [number, number]);
    const maxAcross = Math.max(...pts.map(([a]) => Math.abs(a)));
    const maxReach = Math.max(...pts.map(([a, b]) => Math.hypot(a, b)));
    expect(isClose(maxAcross, half)).toBe(true);
    expect(half < maxReach && maxReach < half * Math.sqrt(2.0)).toBe(true);
    const perim = loopPerimeter(loop);
    expect(0.99 * perimeter < perim && perim <= perimeter).toBe(true);
  });

  it("squircle has straight bottom feed side", () => {
    const egg = makeEggbeater(4.0, 4.0, 1.0, 0.001, 72, SHAPE_SQUIRCLE, 0.2);
    const feed = egg.loopA.wires[0]!;
    expect(isClose(feed.z1, feed.z2, 1e-9, 1e-9)).toBe(true);
    const lowest = Math.min(...egg.loopA.wires.map((w) => Math.min(w.z1, w.z2)));
    expect(isClose(feed.z1, lowest, 1e-9, 1e-9)).toBe(true);
  });

  it("squircle corner radius must be below circle radius", () => {
    expect(() =>
      makeEggbeater(4.0, 4.0, 1.0, 0.001, 36, SHAPE_SQUIRCLE, 4.0 / (2.0 * Math.PI)),
    ).toThrow();
    expect(() =>
      makeEggbeater(4.0, 4.0, 1.0, 0.001, 36, SHAPE_SQUIRCLE, 0.0),
    ).toThrow();
  });

  it("loop extent per shape", () => {
    expect(isClose(loopExtentM(2.0 * Math.PI, "circle"), 2.0)).toBe(true);
    expect(isClose(loopExtentM(4.0, SHAPE_SQUARE), 1.0)).toBe(true);
    expect(
      isClose(loopExtentM(4.0, SHAPE_SQUIRCLE, 0.2), roundedSquareSide(4.0, 0.2)),
    ).toBe(true);
    expect(loopExtentM(4.0, SHAPE_SQUIRCLE, 0.2) > loopExtentM(4.0, SHAPE_SQUARE)).toBe(
      true,
    );
  });
});
