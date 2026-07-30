// Design spec model and JSON serialization. Port of src/awadateki/spec.py plus
// the DesignSpec/Optimization dataclasses from src/awadateki/design.py.
//
// The JSON form is the canonical representation. Only freqMhz and conductor are
// required; every other field falls back to the DesignSpec defaults. A JSON
// document may hold one spec object or a list of them. The snake_case keys are
// preserved at the JSON boundary; the in-memory model is camelCase.
//
// The runtime-only nec2c executable path is intentionally not serialized.

import { type Coax, catalogCoax } from "./coax";
import {
  type Conductor,
  KIND_BAR,
  KIND_ROUND,
  KIND_STRIP,
  barConductor,
  roundConductor,
  stripConductor,
} from "./conductor";
import {
  AR_MARGIN_DB,
  DEFAULT_NEC2C,
  FEED_LINE,
  REFLECTOR_NONE,
  SENSE_RHCP,
} from "./constants";
import { SHAPE_CIRCLE } from "./geometry";

// Provenance of a spec produced by the reflector optimizer. Round-tripped
// verbatim; nothing in this wave produces it.
export interface Optimization {
  input: DesignSpec;
  method: string;
  spacingBoundsWl: [number, number];
  droopBoundsDeg: [number, number];
  spacingToleranceWl: number;
  droopToleranceDeg: number;
  sweeps: number;
  radialCountGrid: number[];
  arTargetDb: number;
  arMarginDb: number;
  arPenaltyPerDb: number;
  feasibleVswr: number;
  objective: string;
  elapsedS: number;
}

// Inputs that define a design problem. Only freqMhz and conductor are required;
// every other field has a default (see DEFAULT_SPEC) that is the single source
// of defaults for both the future CLI equivalent and JSON.
export interface DesignSpec {
  freqMhz: number;
  conductor: Conductor;
  reflector: string;
  reflectorSpacingWl: number;
  feed: string;
  phasingCoax: Coax | null;
  matchCoax: Coax | null;
  measuredLoopZOhm: number | null;
  sense: string;
  loopShape: string;
  cornerRadiusWl: number;
  // Optional: literal loop perimeter (mm). Absent by default; when present the
  // web Analyze evaluates it literally. Carried through round-trips; nothing in
  // this wave consumes it. See docs/web-ux.md "Spec/API implications".
  loopPerimeterMm: number | null;
  loopOffsetMm: number;
  feedGapMm: number;
  systemZOhm: number;
  arMarginDb: number;
  segments: number | null;
  radialCount: number;
  radialLengthWl: number;
  radialDroopDeg: number;
  label: string | null;
  notes: string | null;
  optimization: Optimization | null;
  nec2c: string;
}

// Field defaults, mirroring the Python DesignSpec dataclass defaults.
const SPEC_DEFAULTS = {
  reflector: REFLECTOR_NONE,
  reflectorSpacingWl: 0.25,
  feed: FEED_LINE,
  phasingCoax: null,
  matchCoax: null,
  measuredLoopZOhm: null,
  sense: SENSE_RHCP,
  loopShape: SHAPE_CIRCLE,
  cornerRadiusWl: 0.05,
  loopPerimeterMm: null,
  loopOffsetMm: 10.0,
  feedGapMm: 10.0,
  systemZOhm: 50.0,
  arMarginDb: AR_MARGIN_DB,
  segments: null,
  radialCount: 8,
  radialLengthWl: 0.27,
  radialDroopDeg: 0.0,
  label: null,
  notes: null,
  optimization: null,
  nec2c: DEFAULT_NEC2C,
} as const;

// Build a DesignSpec from the required fields plus any overrides.
export function makeDesignSpec(
  freqMhz: number,
  conductor: Conductor,
  overrides: Partial<Omit<DesignSpec, "freqMhz" | "conductor">> = {},
): DesignSpec {
  return { freqMhz, conductor, ...SPEC_DEFAULTS, ...overrides };
}

// Optional spec fields carried in JSON, as [camelCase key, snake_case key], in a
// stable output order. loop_perimeter_mm is new to the web port; the rest match
// the Python _OPTIONAL_FIELDS order.
const OPTIONAL_FIELDS: Array<[keyof DesignSpec, string]> = [
  ["sense", "sense"],
  ["feed", "feed"],
  ["loopShape", "loop_shape"],
  ["cornerRadiusWl", "corner_radius_wl"],
  ["loopPerimeterMm", "loop_perimeter_mm"],
  ["loopOffsetMm", "loop_offset_mm"],
  ["feedGapMm", "feed_gap_mm"],
  ["phasingCoax", "phasing_coax"],
  ["matchCoax", "match_coax"],
  ["measuredLoopZOhm", "measured_loop_z_ohm"],
  ["systemZOhm", "system_z_ohm"],
  ["reflector", "reflector"],
  ["reflectorSpacingWl", "reflector_spacing_wl"],
  ["arMarginDb", "ar_margin_db"],
  ["segments", "segments"],
  ["radialCount", "radial_count"],
  ["radialLengthWl", "radial_length_wl"],
  ["radialDroopDeg", "radial_droop_deg"],
  ["label", "label"],
  ["notes", "notes"],
];

// Spec fields holding a Coax; serialized through coaxToDict/coaxFromDict.
const COAX_FIELDS = new Set(["phasingCoax", "matchCoax"]);

export type JsonObject = Record<string, unknown>;

export function conductorToDict(conductor: Conductor): JsonObject {
  if (conductor.kind === KIND_ROUND) {
    return { kind: KIND_ROUND, diameter_mm: conductor.dimensionsMm[0] };
  }
  if (conductor.kind === KIND_STRIP) {
    return { kind: KIND_STRIP, width_mm: conductor.dimensionsMm[0] };
  }
  return {
    kind: KIND_BAR,
    width_mm: conductor.dimensionsMm[0],
    thickness_mm: conductor.dimensionsMm[1],
  };
}

export function conductorFromDict(data: JsonObject): Conductor {
  const kind = data.kind;
  if (kind === KIND_ROUND) {
    return roundConductor(Number(data.diameter_mm));
  }
  if (kind === KIND_STRIP) {
    return stripConductor(Number(data.width_mm));
  }
  if (kind === KIND_BAR) {
    return barConductor(Number(data.width_mm), Number(data.thickness_mm));
  }
  throw new Error(`unknown conductor kind: ${JSON.stringify(kind)}`);
}

export function coaxToDict(coax: Coax): JsonObject {
  return { name: coax.name, z0_ohm: coax.z0Ohm, vf: coax.vf };
}

// A catalog cable name ("RG-62") or an object {name?, z0_ohm, vf}.
export function coaxFromDict(data: unknown): Coax {
  if (typeof data === "string") {
    return catalogCoax(data);
  }
  const obj = data as JsonObject;
  return {
    name: typeof obj.name === "string" ? obj.name : "custom",
    z0Ohm: Number(obj.z0_ohm),
    vf: Number(obj.vf),
  };
}

export function optimizationToDict(opt: Optimization): JsonObject {
  return {
    input: specToDict(opt.input),
    elapsed_s: opt.elapsedS,
    search: {
      method: opt.method,
      spacing_bounds_wl: [...opt.spacingBoundsWl],
      droop_bounds_deg: [...opt.droopBoundsDeg],
      spacing_tolerance_wl: opt.spacingToleranceWl,
      droop_tolerance_deg: opt.droopToleranceDeg,
      sweeps: opt.sweeps,
      radial_count_grid: [...opt.radialCountGrid],
      ar_target_db: opt.arTargetDb,
      ar_margin_db: opt.arMarginDb,
      ar_penalty_per_db: opt.arPenaltyPerDb,
      feasible_vswr: opt.feasibleVswr,
      objective: opt.objective,
    },
  };
}

export function optimizationFromDict(data: JsonObject): Optimization {
  const search = data.search as JsonObject;
  const spacing = search.spacing_bounds_wl as number[];
  const droop = search.droop_bounds_deg as number[];
  return {
    input: specFromDict(data.input as JsonObject),
    method: String(search.method),
    spacingBoundsWl: [Number(spacing[0]), Number(spacing[1])],
    droopBoundsDeg: [Number(droop[0]), Number(droop[1])],
    spacingToleranceWl: Number(search.spacing_tolerance_wl),
    droopToleranceDeg: Number(search.droop_tolerance_deg),
    sweeps: Number(search.sweeps),
    radialCountGrid: (search.radial_count_grid as number[]).map(Number),
    arTargetDb: Number(search.ar_target_db),
    arMarginDb: Number(search.ar_margin_db),
    arPenaltyPerDb: Number(search.ar_penalty_per_db),
    feasibleVswr: Number(search.feasible_vswr),
    objective: String(search.objective),
    elapsedS: Number(data.elapsed_s),
  };
}

// Serialize a spec; nullable fields (label, notes, coax overrides, loop
// perimeter) and optimization are included only when set.
export function specToDict(spec: DesignSpec): JsonObject {
  const data: JsonObject = {
    freq_mhz: spec.freqMhz,
    conductor: conductorToDict(spec.conductor),
  };
  for (const [camel, snake] of OPTIONAL_FIELDS) {
    const value = spec[camel];
    if (value === null || value === undefined) {
      continue;
    }
    data[snake] = COAX_FIELDS.has(camel) ? coaxToDict(value as Coax) : value;
  }
  if (spec.optimization !== null) {
    data.optimization = optimizationToDict(spec.optimization);
  }
  return data;
}

// Build a spec from a dict; missing fields use the DesignSpec defaults.
export function specFromDict(data: JsonObject): DesignSpec {
  const overrides: Partial<DesignSpec> = {};
  for (const [camel, snake] of OPTIONAL_FIELDS) {
    if (!(snake in data)) {
      continue;
    }
    const raw = data[snake];
    if (COAX_FIELDS.has(camel)) {
      (overrides as JsonObject)[camel] = coaxFromDict(raw);
    } else {
      (overrides as JsonObject)[camel] = raw;
    }
  }
  if ("optimization" in data) {
    overrides.optimization = optimizationFromDict(data.optimization as JsonObject);
  }
  return makeDesignSpec(
    Number(data.freq_mhz),
    conductorFromDict(data.conductor as JsonObject),
    overrides,
  );
}

// Parse one spec object or a list of them into a list of specs.
export function specsFromJson(text: string): DesignSpec[] {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => specFromDict(item as JsonObject));
  }
  return [specFromDict(parsed as JsonObject)];
}

// Serialize specs to JSON; a single spec becomes an object, not a list.
export function specsToJson(specs: DesignSpec[]): string {
  const payload = specs.map(specToDict);
  return JSON.stringify(payload.length === 1 ? payload[0] : payload, null, 2);
}
