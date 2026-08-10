// Ported from the DesignInfeasible guards in the retired Python test_cli.py. Both guards are
// pure geometry / solver bookkeeping, so no nec2c is needed.

import { describe, expect, it } from "vitest";
import { roundConductor } from "../src/engine/conductor";
import { DesignInfeasible, buildDeckText, secant } from "../src/engine/design";
import { type DesignSpec, makeDesignSpec } from "../src/engine/spec";

function spec(
  overrides: Partial<Omit<DesignSpec, "freqMhz" | "conductor">> = {},
): DesignSpec {
  return makeDesignSpec(145.9, roundConductor(3.0), {
    reflector: "radials",
    loopShape: "circle",
    reflectorSpacingWl: 0.25,
    sense: "rhcp",
    segments: 16,
    ...overrides,
  });
}

const deck = (s: DesignSpec, factor: number): string =>
  buildDeckText(s, factor, false, null, null);

describe("loop must clear the reflector plane", () => {
  it("rejects spacings that put the loop through the reflector", () => {
    // A full-wave circular loop has radius ~0.167 wavelengths, so spacings below
    // that put its lower half through the reflector; nec2c would solve the
    // shorted structure and report impossibly high gain.
    expect(() => deck(spec({ reflectorSpacingWl: 0.15 }), 1.05)).toThrow(
      DesignInfeasible,
    );
    expect(() => deck(spec({ reflectorSpacingWl: 0.15 }), 1.05)).toThrow(
      /below the reflector plane/,
    );
    expect(() => deck(spec({ reflectorSpacingWl: 0.25 }), 1.05)).not.toThrow();
  });

  it("applies to a ground plane but not to free space", () => {
    expect(() =>
      deck(spec({ reflector: "ground", reflectorSpacingWl: 0.15 }), 1.05),
    ).toThrow(/below the reflector plane/);
    expect(() =>
      deck(spec({ reflector: "none", reflectorSpacingWl: 0.15 }), 1.05),
    ).not.toThrow();
  });
});

describe("secant reports its residual", () => {
  it("distinguishes a converged root from a pinned iterate", async () => {
    const [root, residual] = await secant(
      async (x) => x - 2.0,
      0.0,
      1.0,
      [0.0, 5.0],
      1e-6,
    );
    expect(root).toBeCloseTo(2.0, 6);
    expect(Math.abs(residual)).toBeLessThanOrEqual(1e-6);
    // No root in bounds: the iterate pins at a bound and the residual stays
    // large, which is what lets the caller reject it instead of trusting it.
    const [, bad] = await secant(async (x) => x + 10.0, 0.0, 1.0, [0.0, 5.0], 1e-6);
    expect(Math.abs(bad)).toBeGreaterThan(1e-6);
  });
});
