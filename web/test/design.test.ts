// Ported from tests/test_cli.py: the design-level behavior tests. The nec2c
// cases drive the WASM runner; the matching-math and helper cases are pure.

import { describe, expect, it } from "vitest";
import { roundConductor } from "../src/engine/conductor";
import { BALUN4_Q_COAX } from "../src/engine/constants";
import {
  analyze,
  balun4RadioZ,
  bandwidthWithin,
  buildDeckText,
  design,
  frequencySweep,
  lineInputZ,
  loopSegments,
  postMatchVswr,
  quarterWaveTheta,
  vswr,
  wrapPhaseDeg,
} from "../src/engine/design";
import type { Complex } from "../src/engine/nec";
import { type DesignSpec, makeDesignSpec } from "../src/engine/spec";
import { runNec } from "../wasm/runner.mjs";

const AR_TARGET_DB = 3.0;
const VSWR_LIMIT = 2.0;

// Coarse polygon keeps the nec2c-in-the-loop tests fast.
function spec(overrides: Partial<DesignSpec> = {}): DesignSpec {
  return makeDesignSpec(145.9, roundConductor(3.0), {
    reflector: "none",
    reflectorSpacingWl: 0.25,
    sense: "rhcp",
    segments: 16,
    ...overrides,
  });
}

function gwCount(deck: string): number {
  return deck.split("\nGW ").length - 1;
}

function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}
function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

describe("design (nec2c)", () => {
  it("tunes to quadrature", async () => {
    const result = await design(spec(), runNec);
    expect(result.baseFactor).toBeGreaterThan(0.8);
    expect(result.baseFactor).toBeLessThan(1.2);
    expect(Math.abs(Math.abs(result.phaseDiffDeg) - 90.0)).toBeLessThan(1.0);
    expect(Math.abs(result.zIn.im)).toBeLessThan(15.0);
    expect(Number.isFinite(result.arBoresightDb)).toBe(true);
  }, 30_000);

  it("square loop design runs", async () => {
    const result = await design(spec({ loopShape: "square" }), runNec);
    expect(Number.isFinite(result.arBoresightDb)).toBe(true);
    expect(gwCount(result.deck)).toBe(2 * (loopSegments(result.spec) + 2));
  }, 30_000);

  it("radial reflector runs", async () => {
    const s = spec({ reflector: "radials" });
    const result = await design(s, runNec);
    expect(Number.isFinite(result.arBoresightDb)).toBe(true);
    expect(gwCount(result.deck)).toBe(2 * (loopSegments(s) + 2) + s.radialCount);
  }, 30_000);

  it("balun4 feed designs", async () => {
    const result = await design(
      spec({ reflector: "ground", feed: "balun4", segments: 36 }),
      runNec,
    );
    expect(result.zIn.re).toBeGreaterThan(40.0);
    expect(result.zIn.re).toBeLessThan(60.0);
    expect(Math.abs(result.zIn.im)).toBeLessThan(5.0);
    expect(result.loopBalance).toBeLessThan(1.2);
    expect(Number.isFinite(result.arBoresightDb)).toBe(true);
    // No port wires: the Q-section and balun are outside the NEC model.
    expect(gwCount(result.deck)).toBe(2 * (loopSegments(result.spec) + 2));
  }, 60_000);

  it("sense selection flips handedness", async () => {
    const rhcp = await design(spec({ reflector: "ground", sense: "rhcp" }), runNec);
    const lhcp = await design(spec({ reflector: "ground", sense: "lhcp" }), runNec);
    expect(rhcp.sense).toBe("RIGHT");
    expect(lhcp.sense).toBe("LEFT");
  }, 60_000);

  it("crossed design reports the delivered pattern", async () => {
    // The loops' natural sense is RHCP, so LHCP forces the crossed connection;
    // the reported metrics come from the crossed (delivered) run.
    const s = spec({ reflector: "ground", feed: "line", sense: "lhcp" });
    const result = await design(s, runNec);
    expect(result.crossedPhasingLine).toBe(true);
    expect(result.sense).toBe("LEFT");
    // The tuned deck is the crossed one, not the natural connection.
    const { deck } = await analyze(s, result.baseFactor, { flip: true }, runNec);
    expect(result.deck).toBe(deck);
  }, 60_000);

  it("frequency sweep reports both bandwidths", async () => {
    const result = await design(spec({ reflector: "ground" }), runNec);
    const sweep = await frequencySweep(result, runNec, 0.05, 11);
    const center = result.spec.freqMhz;
    const vswrBand = bandwidthWithin(
      sweep.map((p) => [p.freqMhz, p.vswr] as [number, number]),
      VSWR_LIMIT,
    );
    const arBand = bandwidthWithin(
      sweep.map((p) => [p.freqMhz, p.arDb] as [number, number]),
      AR_TARGET_DB,
    );
    expect(vswrBand).not.toBeNull();
    expect(arBand).not.toBeNull();
    const [vLow, vHigh] = vswrBand as [number, number];
    const [aLow, aHigh] = arBand as [number, number];
    expect(vLow).toBeLessThanOrEqual(center);
    expect(center).toBeLessThanOrEqual(vHigh);
    expect(aLow).toBeLessThanOrEqual(center);
    expect(center).toBeLessThanOrEqual(aHigh);
  }, 60_000);
});

describe("matching math and helpers", () => {
  it("unknown feed rejected", () => {
    expect(() =>
      buildDeckText(spec({ feed: "bogus" }), 1.0, false, null, null),
    ).toThrow(/feed/);
  });

  it("vswr negative reference impedance is inf", () => {
    expect(vswr({ re: -50.0, im: 0.0 }, 50.0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("post-match vswr ideal", () => {
    // 112.5 ohm transforms through a 75 ohm quarter wave to exactly 50 ohm.
    expect(postMatchVswr({ re: 112.5, im: 0.0 })).toBeCloseTo(1.0, 6);
  });

  it("post-match vswr carries unfitted reactance", () => {
    const ideal = postMatchVswr({ re: 112.5, im: 0.0 });
    // Below the 10 ohm threshold no series element is fitted; the residual
    // reactance transforms through the quarter wave and degrades the SWR.
    expect(postMatchVswr({ re: 112.5, im: 8.0 })).toBeGreaterThan(ideal + 0.05);
    // Above the threshold the element cancels the reactance exactly.
    expect(postMatchVswr({ re: 112.5, im: -16.0 })).toBeCloseTo(ideal, 9);
  });

  it("post-match vswr negative resistance is inf", () => {
    expect(postMatchVswr({ re: -3.6, im: -0.1 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("balun4 radio z dispersion", () => {
    const zJunction: Complex = { re: 49.6, im: 0.0 };
    // At the design frequency the circuit reduces to the ideal 4:1 step.
    const ideal = (BALUN4_Q_COAX.z0Ohm * BALUN4_Q_COAX.z0Ohm) / zJunction.re / 4.0;
    expect(
      cAbs(cSub(balun4RadioZ(zJunction, 145.9, 145.9), { re: ideal, im: 0.0 })),
    ).toBeLessThan(1e-9);
    // Off design the half-wave balun's own drift shifts the impedance beyond
    // what the Q-section alone would (the old frequency-flat model).
    const theta = quarterWaveTheta(160.0, 145.9);
    const line = lineInputZ(zJunction, BALUN4_Q_COAX.z0Ohm, theta);
    const flat: Complex = { re: line.re / 4.0, im: line.im / 4.0 };
    const dispersive = balun4RadioZ(zJunction, 160.0, 145.9);
    expect(cAbs(cSub(dispersive, flat))).toBeGreaterThan(1.0);
  });

  it("wrap phase deg", () => {
    expect(wrapPhaseDeg(340.0)).toBe(-20.0);
    expect(wrapPhaseDeg(-190.0)).toBe(170.0);
    expect(wrapPhaseDeg(88.0)).toBe(88.0);
    expect(wrapPhaseDeg(180.0)).toBe(-180.0);
  });

  it("bandwidth interpolates edges", () => {
    const pairs: Array<[number, number]> = [
      [100.0, 3.0],
      [101.0, 1.5],
      [102.0, 1.0],
      [103.0, 1.5],
      [104.0, 3.0],
    ];
    const band = bandwidthWithin(pairs, 2.0) as [number, number];
    expect(band[0]).toBeCloseTo(100.667, 3);
    expect(band[1]).toBeCloseTo(103.333, 3);
  });

  it("bandwidth none when center mismatched", () => {
    const pairs: Array<[number, number]> = [
      [100.0, 3.0],
      [101.0, 2.5],
      [102.0, 2.2],
    ];
    expect(bandwidthWithin(pairs, 2.0)).toBeNull();
  });
});
