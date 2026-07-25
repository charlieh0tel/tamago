import { describe, expect, it } from "vitest";
import { type Coax, RG_59, RG_62 } from "../src/engine/coax";
import { barConductor, roundConductor } from "../src/engine/conductor";
import {
  type DesignSpec,
  type JsonObject,
  type Optimization,
  makeDesignSpec,
  specFromDict,
  specToDict,
  specsFromJson,
  specsToJson,
} from "../src/engine/spec";

function spec(overrides: Partial<DesignSpec> = {}): DesignSpec {
  const { freqMhz, conductor, ...rest } = overrides;
  return makeDesignSpec(freqMhz ?? 145.9, conductor ?? roundConductor(5.0), rest);
}

// Ported from tests/test_spec.py.
describe("spec", () => {
  it("round trip round conductor", () => {
    const s = spec({ reflector: "radials", radialDroopDeg: 45.0, sense: "lhcp" });
    expect(specFromDict(specToDict(s))).toEqual(s);
  });

  it("round trip square loop", () => {
    const s = spec({ loopShape: "square" });
    expect(specToDict(s).loop_shape).toBe("square");
    expect(specFromDict(specToDict(s))).toEqual(s);
  });

  it("round trip squircle loop", () => {
    const s = spec({ loopShape: "squircle", cornerRadiusWl: 0.04 });
    const data = specToDict(s);
    expect(data.loop_shape).toBe("squircle");
    expect(data.corner_radius_wl).toBe(0.04);
    expect(specFromDict(data)).toEqual(s);
  });

  it("round trip bar conductor", () => {
    const s = spec({ conductor: barConductor(12.7, 3.2) });
    expect(specFromDict(specToDict(s))).toEqual(s);
  });

  it("round trip with optimization", () => {
    const base = spec();
    const opt: Optimization = {
      input: base,
      method: "coordinate descent (golden-section per axis)",
      spacingBoundsWl: [0.15, 0.4],
      droopBoundsDeg: [0.0, 50.0],
      spacingToleranceWl: 0.005,
      droopToleranceDeg: 1.0,
      sweeps: 2,
      radialCountGrid: [3, 4, 6, 8],
      arTargetDb: 3.0,
      arMarginDb: 0.5,
      arPenaltyPerDb: 1.0,
      feasibleVswr: 1.5,
      objective: "minimize post-match VSWR",
      elapsedS: 12.5,
    };
    const s = spec({
      reflector: "radials",
      reflectorSpacingWl: 0.2,
      radialDroopDeg: 45.0,
      optimization: opt,
    });
    const restored = specFromDict(specToDict(s));
    expect(restored).toEqual(s);
    expect(restored.optimization?.input).toEqual(base);
  });

  it("round trip feed scheme", () => {
    const s = spec({ feed: "turnstile" });
    const data = specToDict(s);
    expect(data.feed).toBe("turnstile");
    expect(specFromDict(data)).toEqual(s);
  });

  it("round trip custom coax", () => {
    const s = spec({
      phasingCoax: { name: "hardline", z0Ohm: 93.0, vf: 0.8 },
      matchCoax: { name: "RG-6", z0Ohm: 75.0, vf: 0.85 },
    });
    expect(specFromDict(specToDict(s))).toEqual(s);
  });

  it("coax accepts catalog name", () => {
    const data = specToDict(spec());
    data.phasing_coax = "RG-62";
    data.match_coax = "RG-59";
    const s = specFromDict(data);
    expect(s.phasingCoax).toEqual<Coax>(RG_62);
    expect(s.matchCoax).toEqual<Coax>(RG_59);
  });

  it("minimal dict uses defaults", () => {
    const s = specFromDict({
      freq_mhz: 436.0,
      conductor: { kind: "round", diameter_mm: 3.0 },
    });
    expect(s.reflector).toBe("none");
    expect(s.sense).toBe("rhcp");
    expect(s.segments).toBe(makeDesignSpec(1.0, s.conductor).segments);
  });

  it("label omitted when unset present when set", () => {
    expect("label" in specToDict(spec())).toBe(false);
    expect(specToDict(spec({ label: "2 m" })).label).toBe("2 m");
  });

  it("notes round trip and omitted when unset", () => {
    expect("notes" in specToDict(spec())).toBe(false);
    const s = spec({ notes: "LEO sat pair, RHCP" });
    expect(specToDict(s).notes).toBe("LEO sat pair, RHCP");
    expect(specFromDict(specToDict(s))).toEqual(s);
  });

  it("loop_perimeter_mm optional: absent by default, carried when set", () => {
    // New optional field for the web port (docs/web-ux.md).
    expect("loop_perimeter_mm" in specToDict(spec())).toBe(false);
    const s = spec({ loopPerimeterMm: 2050.0 });
    const data = specToDict(s);
    expect(data.loop_perimeter_mm).toBe(2050.0);
    expect(specFromDict(data)).toEqual(s);
  });

  it("json single object round trip", () => {
    const s = spec({ label: "2 m" });
    const specs = specsFromJson(specsToJson([s]));
    expect(specs).toEqual([s]);
    // A single spec serializes as an object, not a list.
    expect(specsToJson([s]).trimStart().startsWith("{")).toBe(true);
  });

  it("json list round trip", () => {
    const pair = [spec({ label: "2 m" }), makeDesignSpec(436.0, roundConductor(3.0))];
    expect(specsFromJson(specsToJson(pair))).toEqual(pair);
  });

  it("optimization dict shape matches python", () => {
    const s = spec({
      optimization: {
        input: spec(),
        method: "m",
        spacingBoundsWl: [0.15, 0.4],
        droopBoundsDeg: [0.0, 50.0],
        spacingToleranceWl: 0.005,
        droopToleranceDeg: 1.0,
        sweeps: 2,
        radialCountGrid: [3, 4, 6, 8],
        arTargetDb: 3.0,
        arMarginDb: 0.5,
        arPenaltyPerDb: 1.0,
        feasibleVswr: 1.5,
        objective: "o",
        elapsedS: 1.0,
      },
    });
    const opt = specToDict(s).optimization as JsonObject;
    // input, elapsed_s, then a nested search block (Python optimization_to_dict).
    expect(Object.keys(opt)).toEqual(["input", "elapsed_s", "search"]);
    expect(Object.keys(opt.search as JsonObject)).toEqual([
      "method",
      "spacing_bounds_wl",
      "droop_bounds_deg",
      "spacing_tolerance_wl",
      "droop_tolerance_deg",
      "sweeps",
      "radial_count_grid",
      "ar_target_db",
      "ar_margin_db",
      "ar_penalty_per_db",
      "feasible_vswr",
      "objective",
    ]);
  });
});
