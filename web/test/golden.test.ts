// Golden parity: for every case in goldens/manifest.json, check the deck text,
// the tuned design result dict, and the cut sheet against the Python-generated
// reference files. The Python and the goldens are the source of truth; the wasm
// nec2c output is byte-identical to native, so the numeric leaves match to
// well under the 1e-9 relative tolerance used here.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { type DesignResult, buildDeckText, design } from "../src/engine/design";
import { formatCutSheet } from "../src/engine/report";
import { resultToDict } from "../src/engine/result";
import { type DesignSpec, specFromDict } from "../src/engine/spec";
import { runNec } from "nec2c-wasm";

interface ManifestCase {
  name: string;
  emits_flipped_deck: boolean;
}

const GOLDENS = new URL("../goldens/", import.meta.url);

function read(name: string): string {
  return readFileSync(new URL(name, GOLDENS), "utf8");
}

function loadSpec(name: string): DesignSpec {
  return specFromDict(JSON.parse(read(`${name}.spec.json`)));
}

const manifest = JSON.parse(read("manifest.json")) as { cases: ManifestCase[] };
const CASES = manifest.cases;

// Structural compare: object key order exact, numeric leaves within relative
// tolerance, strings/booleans/null exact. Returns on first mismatch via expect.
function expectEqualJson(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, `${path}: type`).toBe("number");
    const a = actual as number;
    if (Number.isFinite(expected) && Number.isFinite(a)) {
      const tol = 1e-9 * Math.max(Math.abs(expected), Math.abs(a), 1e-9);
      expect(
        Math.abs(a - expected),
        `${path}: |${a} - ${expected}|`,
      ).toBeLessThanOrEqual(tol);
    } else {
      expect(a, `${path}`).toBe(expected);
    }
    return;
  }
  if (expected === null || typeof expected !== "object") {
    expect(actual, `${path}`).toBe(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: array`).toBe(true);
    const a = actual as unknown[];
    expect(a.length, `${path}: length`).toBe(expected.length);
    expected.forEach((v, i) => expectEqualJson(a[i], v, `${path}[${i}]`));
    return;
  }
  const exp = expected as Record<string, unknown>;
  const act = actual as Record<string, unknown>;
  // Key set and order must match Python's dict insertion order.
  expect(Object.keys(act), `${path}: keys`).toEqual(Object.keys(exp));
  for (const key of Object.keys(exp)) {
    expectEqualJson(act[key], exp[key], `${path}.${key}`);
  }
}

describe("golden decks", () => {
  for (const { name, emits_flipped_deck } of CASES) {
    it(`${name} deck matches`, () => {
      const spec = loadSpec(name);
      expect(buildDeckText(spec, 1.05, false, null, null)).toBe(
        read(`${name}.deck.nec`),
      );
      if (emits_flipped_deck) {
        expect(buildDeckText(spec, 1.05, true, null, null)).toBe(
          read(`${name}.deck-flipped.nec`),
        );
      }
    });
  }
});

describe("golden designs", () => {
  // The tuned designs run nec2c many times; tune each once and reuse it for
  // both the result-dict and cut-sheet checks.
  const results = new Map<string, DesignResult>();

  beforeAll(async () => {
    for (const { name } of CASES) {
      results.set(name, await design(loadSpec(name), runNec));
    }
  }, 120_000);

  for (const { name } of CASES) {
    it(`${name} result dict matches`, () => {
      const expected = JSON.parse(read(`${name}.result.json`));
      // Round-trip through JSON before comparing: the goldens are the serialized
      // artifact, and an axial ratio is infinite dB wherever the pattern is
      // exactly linear. JSON has no infinity, so both engines write null there
      // (JSON.stringify does it for us; Python's json_safe does it explicitly).
      const actual = JSON.parse(
        JSON.stringify(resultToDict(results.get(name) as DesignResult)),
      );
      expectEqualJson(actual, expected, name);
    });
  }

  for (const { name } of CASES) {
    it(`${name} cut sheet matches`, () => {
      expect(formatCutSheet(results.get(name) as DesignResult)).toBe(
        read(`${name}.cutsheet.txt`),
      );
    });
  }
});
