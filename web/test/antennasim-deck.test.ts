// The AntennaSim export replaces the TL harness with quadrature voltage
// sources (AntennaSim's importer discards TL cards). Verify the deck is
// import-safe (no TL, complex EX pair) and that nec2c gives it the same
// boresight sense and a comparable axial ratio to the harness deck.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { antennaSimDeck, antennaSimJson, design } from "../src/engine/design";
import { parseOutput } from "../src/engine/nec";
import { type DesignSpec, specFromDict } from "../src/engine/spec";
import { runNec } from "../wasm/runner.mjs";

const GOLDENS = new URL("../goldens/", import.meta.url);

function loadSpec(name: string): DesignSpec {
  return specFromDict(
    JSON.parse(readFileSync(new URL(`${name}.spec.json`, GOLDENS), "utf8")),
  );
}

// One case per feed scheme.
const CASES = [
  "line_none_circle_rhcp_2m",
  "turnstile_none_circle_rhcp_2m",
  "balun4_none_circle_lhcp_2m",
];

// NEC axial ratio (minor/major, signed by printed sense) at zenith to dB.
function boresight(deckOutput: string): { arDb: number; sense: string } {
  const pattern = parseOutput(deckOutput).pattern;
  const zenith = pattern.find((p) => p.thetaDeg === 0.0 && p.phiDeg === 0.0);
  expect(zenith).toBeDefined();
  const ar = Math.abs(zenith?.axialRatio ?? 0.0);
  return { arDb: -20.0 * Math.log10(ar), sense: zenith?.sense ?? "" };
}

describe("antennaSimDeck", () => {
  for (const name of CASES) {
    it(`${name}: import-safe and equivalent at boresight`, async () => {
      const result = await design(loadSpec(name), runNec);
      const deck = antennaSimDeck(result);

      expect(deck).not.toMatch(/^TL /m);
      const exLines = deck.match(/^EX .*$/gm) ?? [];
      expect(exLines).toHaveLength(2);

      const harness = boresight(await runNec(result.deck));
      const exported = boresight(await runNec(deck));
      expect(exported.sense).toBe(harness.sense);
      // Ideal-quadrature drive can only improve on the harness's phase error;
      // allow a little slack for the loops' mutual coupling.
      expect(exported.arDb).toBeLessThan(Math.max(harness.arDb + 0.5, 1.0));

      // Native project JSON: same sources, AntennaSim's export field shape.
      const project = JSON.parse(antennaSimJson(result));
      expect(project.version).toBe(1);
      expect(project.wires.length).toBeGreaterThan(0);
      for (const w of project.wires) {
        expect(w).toMatchObject({
          tag: expect.any(Number),
          segments: expect.any(Number),
        });
        expect(w.radius).toBeGreaterThan(0.0);
      }
      expect(project.excitations).toHaveLength(2);
      const vB = project.excitations[1];
      expect(Math.hypot(vB.voltage_real, vB.voltage_imag)).toBeCloseTo(1.0, 9);
      expect(Math.abs(vB.voltage_imag)).toBeGreaterThan(0.9);
      expect(project.ground.type).toMatch(/^(free_space|perfect)$/);
    });
  }
});
