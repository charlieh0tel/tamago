import { describe, expect, it } from "vitest";
import { RG_59, RG_62 } from "../src/engine/coax";
import { roundConductor } from "../src/engine/conductor";
import { type DesignSpec, makeDesignSpec } from "../src/engine/spec";
import { validateSpec } from "../src/engine/validate";

// Matches the coarse spec used by the non-nec2c guards in tests/test_cli.py.
function spec(
  overrides: Partial<Omit<DesignSpec, "freqMhz" | "conductor">> = {},
): DesignSpec {
  return makeDesignSpec(145.9, roundConductor(3.0), {
    reflector: "none",
    reflectorSpacingWl: 0.25,
    sense: "rhcp",
    segments: 16,
    ...overrides,
  });
}

// Ported from the non-nec2c validation tests in tests/test_cli.py.
describe("validateSpec", () => {
  it("coax fields rejected for wrong feed", () => {
    // phasing_coax belongs to the line feed only.
    expect(() => validateSpec(spec({ feed: "turnstile", phasingCoax: RG_62 }))).toThrow(
      /phasing_coax/,
    );
    expect(() => validateSpec(spec({ feed: "balun4", phasingCoax: RG_62 }))).toThrow(
      /phasing_coax/,
    );
    // match_coax is meaningless for balun4 but valid for turnstile.
    expect(() => validateSpec(spec({ feed: "balun4", matchCoax: RG_59 }))).toThrow(
      /match_coax/,
    );
    expect(() =>
      validateSpec(spec({ feed: "turnstile", matchCoax: RG_59 })),
    ).not.toThrow();
    expect(() =>
      validateSpec(spec({ phasingCoax: RG_62, matchCoax: RG_59 })),
    ).not.toThrow();
  });

  it("segment count validated", () => {
    expect(() => validateSpec(spec({ segments: 99 }))).toThrow(/segments/);
    expect(() => validateSpec(spec({ segments: 98 }))).not.toThrow();
  });

  it("loop offset clearance validated", () => {
    // 3 mm conductor needs at least 4.5 mm of loop offset (1.5 diameters).
    expect(() => validateSpec(spec({ loopOffsetMm: 4.0 }))).toThrow(/loop_offset_mm/);
    expect(() => validateSpec(spec({ loopOffsetMm: 4.5 }))).not.toThrow();
  });
});
