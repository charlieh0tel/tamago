// Ported from tests/test_result.py: result_to_dict build/performance shape,
// harness dicts per feed, and results_to_json. These use a hand-built
// DesignResult, so they need no nec2c.

import { describe, expect, it } from "vitest";
import { roundConductor } from "../src/engine/conductor";
import type { DesignResult } from "../src/engine/design";
import { resultToDict, resultsToJson } from "../src/engine/result";
import { type DesignSpec, type JsonObject, makeDesignSpec } from "../src/engine/spec";

function result(specOverrides: Partial<DesignSpec> = {}): DesignResult {
  const spec = makeDesignSpec(145.9, roundConductor(5.0), {
    reflector: "radials",
    radialDroopDeg: 40.0,
    ...specOverrides,
  });
  return {
    spec,
    baseFactor: 1.05,
    zIn: { re: 112.5, im: -16.0 },
    phaseDiffDeg: 88.0,
    loopBalance: 1.1,
    crossedPhasingLine: false,
    sense: "RIGHT",
    arBoresightDb: 1.3,
    arConeWorstDb: 2.4,
    arPeakDb: 0.7,
    coverageGainDb: 0.34,
    deck: "",
    loopAFeedZ: { re: 120.0, im: 3.0 },
    loopBFeedZ: { re: 118.5, im: -2.0 },
  };
}

function obj(o: JsonObject, key: string): JsonObject {
  return o[key] as JsonObject;
}

describe("result_to_dict", () => {
  it("build and performance sections", () => {
    const data = resultToDict(result());
    expect(new Set(Object.keys(data))).toEqual(
      new Set(["spec", "build", "performance"]),
    );
    const build = obj(data, "build");
    expect("large_loop" in build).toBe(false);
    expect((obj(build, "loop").perimeter_mm as number) > 0.0).toBe(true);
    expect((obj(build, "phasing_line").length_mm as number) > 0.0).toBe(true);
    expect(obj(obj(build, "phasing_line"), "coax").name).toBe("RG-62");
    expect(obj(obj(build, "phasing_line"), "coax").z0_ohm).toBe(93.0);
    expect(obj(build, "phasing_line").connection).toBe("normal");
    expect(build.feed_gap_mm).toBe(10.0);
    expect(obj(build, "radials").count).toBe(8);
    // Capacitive feed (-16j) is canceled by a series inductor.
    expect(obj(obj(build, "match"), "series_element").kind).toBe("inductor");
    // 112.5 ohm to 50 ohm wants a 75 ohm transformer: RG-59 from the catalog.
    expect(obj(obj(build, "match"), "transformer_coax").name).toBe("RG-59");
    const perf = obj(data, "performance");
    expect(perf.feed_z_kind).toBe("feedpoint");
    expect(perf.loop_balance).toBe(1.1);
    expect(perf.axial_ratio_cone_worst_db).toBe(2.4);
    expect(perf.coverage_gain_dbi).toBe(0.34);
    expect(perf.sense).toBe("RHCP");
    expect(perf.sense_achieved).toBe(true);
  });

  it("turnstile build sections", () => {
    const build = obj(resultToDict(result({ feed: "turnstile" })), "build");
    expect(build.feed).toBe("turnstile");
    expect("phasing_line" in build).toBe(false);
    const harness = obj(build, "harness");
    expect(obj(obj(harness, "q_section"), "coax").name).toBe("RG-59");
    expect(obj(harness, "q_section").count).toBe(2);
    expect(obj(obj(harness, "delay_line"), "coax").name).toBe("RG-58");
    expect(obj(harness, "balun")).toEqual({ kind: "1:1 current choke" });
    expect(obj(obj(build, "match"), "transformer_coax").name).toBe("RG-59");
  });

  it("balun4 build sections", () => {
    const build = obj(resultToDict(result({ feed: "balun4" })), "build");
    const harness = obj(build, "harness");
    expect(obj(obj(harness, "phasing_line"), "coax").name).toBe("2x RG-58 (balanced)");
    expect(obj(obj(harness, "phasing_line"), "coax").z0_ohm).toBe(100.0);
    expect(obj(obj(harness, "q_section"), "coax").name).toBe("2x RG-58 (balanced)");
    expect(obj(harness, "balun").kind).toBe("half-wave 4:1");
    expect(obj(obj(harness, "balun"), "coax").name).toBe("RG-58");
    // Half wave of RG-58 is twice the quarter-wave phasing-line cut.
    expect(obj(harness, "balun").length_mm).toBeCloseTo(
      2.0 * (obj(harness, "phasing_line").length_mm as number),
      9,
    );
    expect(obj(build, "match")).toEqual({ system_z_ohm: 50.0, network: "harness" });
  });

  it("bandwidth absent unless requested", () => {
    expect("bandwidth" in resultToDict(result())).toBe(false);
  });

  it("results_to_json single is object", () => {
    expect(Array.isArray(JSON.parse(resultsToJson([result()])))).toBe(false);
  });

  it("results_to_json list", () => {
    const payload = JSON.parse(resultsToJson([result(), result({ freqMhz: 436.0 })]));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(2);
  });
});
