import { describe, expect, it } from "vitest";
import { makeEggbeater } from "../src/engine/geometry";
import {
  type RadiationGrid,
  type Source,
  buildDeck,
  parseOutput,
  sourceCurrentPhaseDeg,
} from "../src/engine/nec";

// Copied verbatim from tests/test_nec.py: trimmed nec2c output covering two
// sources and a few pattern directions, including an exact-zenith row that omits
// the textual polarization sense. The fixed columns must be preserved exactly.
const SAMPLE_OUTPUT = `
                        --------- ANTENNA INPUT PARAMETERS ---------
  TAG   SEG       VOLTAGE (VOLTS)         CURRENT (AMPS)         IMPEDANCE (OHMS)        ADMITTANCE (MHOS)     POWER
  No:   No:     REAL      IMAGINARY     REAL      IMAGINARY     REAL      IMAGINARY    REAL       IMAGINARY   (WATTS)
  100     1  1.0000E+00  0.0000E+00  5.0000E-03  5.0000E-03  1.0000E+02  -1.0000E+02  5.0E-03  5.0E-03  2.5E-03
  200     1  1.0000E+00  0.0000E+00  5.0000E-03 -5.0000E-03  1.0000E+02   1.0000E+02  5.0E-03 -5.0E-03  2.5E-03


                             ---------- RADIATION PATTERNS -----------

 ---- ANGLES -----     ----- POWER GAINS -----       ---- POLARIZATION ----   ---- E(THETA) ----    ----- E(PHI) ------
  THETA      PHI       VERTC    HORIZ    TOTAL       AXIAL      TILT  SENSE   MAGNITUDE    PHASE    MAGNITUDE     PHASE
 DEGREES   DEGREES        DB       DB       DB       RATIO   DEGREES            VOLTS/M   DEGREES     VOLTS/M   DEGREES
    0.00      0.00     2.00     2.00     5.00      0.9800      0.00         1.0E-01      0.00  1.0E-01     90.00
   30.00      0.00     1.00     1.00     3.00      0.8000     10.00 RIGHT   8.0E-02     12.00  6.0E-02     95.00
   60.00      0.00  -999.99  -999.99  -999.99      0.0000      0.00 LINEAR  0.0E+00      0.00  0.0E+00      0.00
`;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// Ported from tests/test_nec.py.
describe("nec", () => {
  it("parse sources", () => {
    const result = parseOutput(SAMPLE_OUTPUT);
    expect(result.sources.length).toBe(2);
    const [a, b] = result.sources;
    expect(a?.tag).toBe(100);
    expect(a?.zReal).toBeCloseTo(100.0, 9);
    expect(a?.zImag).toBeCloseTo(-100.0, 9);
    expect(sourceCurrentPhaseDeg(a!)).toBeCloseTo(45.0, 9);
    expect(sourceCurrentPhaseDeg(b!)).toBeCloseTo(-45.0, 9);
  });

  it("parse pattern handles missing sense", () => {
    const result = parseOutput(SAMPLE_OUTPUT);
    expect(result.pattern.length).toBe(3);
    const zenith = result.pattern[0]!;
    expect(zenith.sense).toBe("LINEAR");
    expect(zenith.axialRatio).toBeCloseTo(0.98, 9);
    expect(result.pattern[1]?.sense).toBe("RIGHT");
  });

  it("build deck emits expected cards", () => {
    const egg = makeEggbeater(1.0, 1.0, 0.5, 0.001, 12);
    const sources: Source[] = [
      {
        tag: egg.loopA.feedTag,
        segment: egg.loopA.feedSegment,
        vReal: 1.0,
        vImag: 0.0,
      },
      {
        tag: egg.loopB.feedTag,
        segment: egg.loopB.feedSegment,
        vReal: 0.0,
        vImag: -1.0,
      },
    ];
    const grid: RadiationGrid = {
      ntheta: 9,
      nphi: 7,
      theta0: 0.0,
      phi0: 0.0,
      dtheta: 10.0,
      dphi: 15.0,
    };
    const deck = buildDeck(["test"], egg.wires, sources, true, 145.9, grid);
    expect(deck.startsWith("CM test")).toBe(true);
    expect(deck.includes("GN 1")).toBe(true);
    expect(deck.includes("GE -1")).toBe(true);
    expect(countOccurrences(deck, "\nEX ")).toBe(2);
    expect(countOccurrences(deck, "\nGW ")).toBe(24);
    expect(deck.trimEnd().endsWith("EN")).toBe(true);
  });

  it("build deck free space has no ground", () => {
    const egg = makeEggbeater(1.0, 1.0, 0.5, 0.001, 12);
    const sources: Source[] = [{ tag: 100, segment: 1, vReal: 1.0, vImag: 0.0 }];
    const grid: RadiationGrid = {
      ntheta: 9,
      nphi: 7,
      theta0: 0.0,
      phi0: 0.0,
      dtheta: 10.0,
      dphi: 15.0,
    };
    const deck = buildDeck(["t"], egg.wires, sources, false, 145.9, grid);
    expect(deck.includes("GE 0")).toBe(true);
    expect(deck.includes("GN")).toBe(false);
  });
});
