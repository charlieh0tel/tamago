// Spec <-> URL-fragment round-trip and hash parsing.
import { describe, expect, it } from "vitest";
import { decodeSpec, encodeSpec, parseHash } from "../src/app/hash";
import { roundConductor } from "../src/engine/index";
import { REFLECTOR_RADIALS, makeDesignSpec } from "../src/engine/index";

describe("spec hash round-trip", () => {
  it("encodes and decodes a spec through base64url", () => {
    const spec = makeDesignSpec(145.9, roundConductor(5.0), {
      label: "2 m",
      reflector: REFLECTOR_RADIALS,
      radialCount: 3,
      reflectorSpacingWl: 0.216,
      radialDroopDeg: 29.5,
      loopPerimeterMm: 2161.3,
    });
    const encoded = encodeSpec(spec);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    const back = decodeSpec(encoded);
    expect(back.freqMhz).toBe(145.9);
    expect(back.label).toBe("2 m");
    expect(back.reflector).toBe(REFLECTOR_RADIALS);
    expect(back.radialCount).toBe(3);
    expect(back.loopPerimeterMm).toBeCloseTo(2161.3, 4);
  });

  it("parses #spec and #report fragments", () => {
    const spec = makeDesignSpec(145.9, roundConductor(5.0));
    const encoded = encodeSpec(spec);
    const parsed = parseHash(`#spec=${encoded}&report`);
    expect(parsed.report).toBe(true);
    expect(parsed.spec?.freqMhz).toBe(145.9);
  });

  it("returns a null spec for a malformed fragment", () => {
    const parsed = parseHash("#spec=not-valid-base64!!!");
    expect(parsed.spec).toBeNull();
    expect(parsed.report).toBe(false);
  });
});
