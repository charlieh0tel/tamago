// The wasm runner's failure path. Module.quit is not an Emscripten override
// point, so an earlier version of this wrapper never observed a nonzero exit:
// a failed solve returned the partial output file and parsed to an empty
// NecResult, which the caller could not tell from a real one.

import { runNec } from "nec2c-wasm";
import { describe, expect, it } from "vitest";

const GOOD_DECK = [
  "CM parity fixture",
  "CE",
  "GW 1 9 0 0 0 0 0 1 0.001",
  "GE 0",
  "EX 0 1 5 0 1 0",
  "FR 0 1 0 0 145.9 0",
  "RP 0 3 1 1000 0 0 30 0",
  "EN",
].join("\n");

describe("wasm runner", () => {
  it("returns nec2c output for a valid deck", async () => {
    const out = await runNec(`${GOOD_DECK}\n`);
    expect(out).toContain("ANTENNA INPUT PARAMETERS");
  });

  it("rejects a deck nec2c cannot parse", async () => {
    await expect(runNec("total garbage not a deck\n")).rejects.toThrow(
      /nec2c exited with code/,
    );
  });

  it("leaves the host process exit code alone after a failure", async () => {
    // Emscripten's exit path assigns process.exitCode; a library must not
    // decide the exit status of the program embedding it.
    const before = process.exitCode;
    await expect(runNec("total garbage not a deck\n")).rejects.toThrow();
    expect(process.exitCode).toBe(before);
  });

  it("carries nec2c's own diagnostic in the message", async () => {
    // nec2c writes this into its output file, not to stderr.
    await expect(runNec("total garbage not a deck\n")).rejects.toThrow(
      /GEOMETRY DATA CARD ERROR/,
    );
  });
});
