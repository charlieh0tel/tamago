// Structured, JSON-serializable view of a tuned design. Port of
// src/awadateki/result.py.
//
// resultToDict is the single source of the derived numbers: the build cut list
// (loop dimensions and matching hardware) and the predicted performance. The
// text cut sheet (report.ts) renders from this dict, so the numbers cannot
// diverge between outputs. Key insertion order mirrors the Python dicts so the
// JSON shape and order match.

import type { Coax } from "./coax";
import { equivalentRadiusM } from "./conductor";
import {
  BALUN4_BALUN_COAX,
  BALUN4_PHASING_COAX,
  BALUN4_Q_COAX,
  BALUN_LINE_WL,
  CHOKE_CORE_PN_UHF,
  CHOKE_CORE_PN_VHF,
  CHOKE_FEED_COAX,
  CHOKE_FERRITE_CORES,
  CHOKE_PHASING_COAX,
  CHOKE_UHF_THRESHOLD_MHZ,
  FEED_BALUN4,
  FEED_CHOKE,
  FEED_LINE,
  LOOP_SEGMENT_RADII_WARN,
  LOOP_SEGMENT_WL_WARN,
  NEC_SENSE_TO_HAND,
  REFLECTOR_NONE,
  REFLECTOR_RADIALS,
} from "./constants";
import {
  type DesignResult,
  loopSegmentLengthM,
  loopSegments,
  matchIsUseful,
  matchedVswr,
  phasingLineCoax,
  quarterWaveMatchZ0,
  seriesElementFitted,
  seriesMatchElement,
  transformerCoax,
  vswr,
} from "./design";
import { SHAPE_SQUIRCLE, loopExtentM, wavelengthM } from "./geometry";
import type { Complex } from "./nec";
import { type JsonObject, specToDict } from "./spec";

const MM_PER_M = 1000.0;
const PF_PER_FARAD = 1.0e12;
const NH_PER_HENRY = 1.0e9;
// Fraction of a wavelength in a quarter-wave line (phasing or transformer).
const QUARTER_WAVE = 0.25;

function coaxDict(coax: Coax): JsonObject {
  return { name: coax.name, z0_ohm: coax.z0Ohm, vf: coax.vf };
}

// Physical cut length of an electrical quarter wave in the given coax.
function quarterWaveMm(wavelength: number, coax: Coax): number {
  return QUARTER_WAVE * wavelength * coax.vf * MM_PER_M;
}

function loopDims(
  perimeterM: number,
  shape: string,
  cornerRadiusM: number,
): JsonObject {
  return {
    perimeter_mm: perimeterM * MM_PER_M,
    width_mm: loopExtentM(perimeterM, shape, cornerRadiusM) * MM_PER_M,
  };
}

function matchDict(result: DesignResult, wavelength: number): JsonObject {
  const spec = result.spec;
  const z = result.zIn;
  if (spec.feed === FEED_BALUN4) {
    // The Q-section and balun in the harness are the match network.
    return { system_z_ohm: spec.systemZOhm, network: "harness" };
  }
  if (spec.feed === FEED_CHOKE) {
    // A 1:1 ferrite choke: no impedance transform, the radio sees z.
    return { system_z_ohm: spec.systemZOhm, network: "choke" };
  }
  if (!matchIsUseful(spec, z)) {
    // The junction already sits at the system impedance; a transformer here
    // would be an inert section of coax.
    return { system_z_ohm: spec.systemZOhm, network: "direct" };
  }
  const z0 = quarterWaveMatchZ0(z, spec.systemZOhm);
  const coax = transformerCoax(z, spec.systemZOhm, spec.matchCoax);
  let series: JsonObject | null = null;
  if (seriesElementFitted(z)) {
    const [kind, value] = seriesMatchElement(z, spec.freqMhz);
    series = { kind };
    if (kind === "capacitor") {
      series.value_pf = value * PF_PER_FARAD;
    } else {
      series.value_nh = value * NH_PER_HENRY;
    }
  }
  return {
    system_z_ohm: spec.systemZOhm,
    series_element: series,
    transformer_z0_ohm: z0,
    transformer_coax: coaxDict(coax),
    transformer_length_mm: quarterWaveMm(wavelength, coax),
  };
}

// Harness pieces for the balanced feeds (balun4 and choke).
function harnessDict(result: DesignResult, wavelength: number): JsonObject {
  const spec = result.spec;
  const connection = result.crossedPhasingLine ? "crossed" : "normal";
  if (spec.feed === FEED_CHOKE) {
    const corePn =
      spec.freqMhz >= CHOKE_UHF_THRESHOLD_MHZ ? CHOKE_CORE_PN_UHF : CHOKE_CORE_PN_VHF;
    return {
      phasing_line: {
        coax: coaxDict(CHOKE_PHASING_COAX),
        length_mm: quarterWaveMm(wavelength, CHOKE_PHASING_COAX),
      },
      balun: {
        kind: "1:1 ferrite choke",
        coax: coaxDict(CHOKE_FEED_COAX),
        cores: CHOKE_FERRITE_CORES,
        core_pn: corePn,
      },
      connection,
    };
  }
  return {
    phasing_line: {
      coax: coaxDict(BALUN4_PHASING_COAX),
      length_mm: quarterWaveMm(wavelength, BALUN4_PHASING_COAX),
    },
    q_section: {
      coax: coaxDict(BALUN4_Q_COAX),
      length_mm: quarterWaveMm(wavelength, BALUN4_Q_COAX),
    },
    balun: {
      kind: "half-wave 4:1",
      coax: coaxDict(BALUN4_BALUN_COAX),
      length_mm: BALUN_LINE_WL * wavelength * BALUN4_BALUN_COAX.vf * MM_PER_M,
    },
    connection,
  };
}

// NEC discretization and the two ratios that bound its validity. segment_radii
// is the binding one for the loop impedance (the thin-wire kernel); segment_wl
// bounds current resolution. A thick conductor cannot satisfy both, so both are
// reported rather than enforced; see docs/segmentation.md.
function meshDict(result: DesignResult, wavelength: number): JsonObject {
  const spec = result.spec;
  const segmentM = loopSegmentLengthM(spec, result.baseFactor * wavelength);
  return {
    loop_segments: loopSegments(spec),
    derived: spec.segments === null,
    segment_length_mm: segmentM * MM_PER_M,
    segment_wl: segmentM / wavelength,
    segment_radii: segmentM / equivalentRadiusM(spec.conductor),
    segment_radii_warn: LOOP_SEGMENT_RADII_WARN,
    segment_wl_warn: LOOP_SEGMENT_WL_WARN,
  };
}

// On-axis axial ratio implied by a current-amplitude split alone.
function arFloorDb(balance: number): number {
  return balance > 0.0
    ? Math.abs(20.0 * Math.log10(balance))
    : Number.POSITIVE_INFINITY;
}

// Where the loop current split -- and so the axial ratio -- comes from.
//
// A quarter-wave phasing line converts junction voltage to loop-B current
// through its own Z0, while loop A is driven directly, so the split is exactly
// |Z_loop| / Z0. That relation is transmission-line theory and holds whatever one
// thinks of the model; the loop impedance in it is the shakiest number we
// produce, because a point-fed closed loop is a case NEC handles poorly. So a
// measured value (spec.measuredLoopZOhm) is used in preference, and the source is
// reported either way.
//
// A measurement reaches only this relation, never the NEC solve, so
// modeled_loop_z_ohm is carried alongside: when the two disagree the pattern
// figures elsewhere in the result belong to the modeled antenna, and the report
// needs both numbers to say so.
function driveDict(result: DesignResult, phasingZ0Ohm: number): JsonObject {
  const loopZ = result.loopAFeedZ;
  const modeled = loopZ !== null ? Math.hypot(loopZ.re, loopZ.im) : null;
  const measured = result.spec.measuredLoopZOhm;
  const used = measured !== null ? measured : modeled;
  const source = measured !== null ? "measured" : modeled !== null ? "modeled" : null;
  // Recompute from the relation when measured, so the reading -- not the model --
  // sets the reported split.
  const balance = measured !== null ? measured / phasingZ0Ohm : result.loopBalance;
  return {
    phasing_z0_ohm: phasingZ0Ohm,
    loop_z_ohm: used,
    loop_z_source: source,
    modeled_loop_z_ohm: modeled,
    balance,
    ar_floor_db: arFloorDb(balance),
  };
}

function buildDict(result: DesignResult): JsonObject {
  const spec = result.spec;
  const wavelength = wavelengthM(spec.freqMhz);
  const build: JsonObject = {
    freq_mhz: spec.freqMhz,
    wavelength_mm: wavelength * MM_PER_M,
    loop_shape: spec.loopShape,
    reflector: spec.reflector,
  };
  if (spec.reflector !== REFLECTOR_NONE) {
    build.loop_center_height_wl = spec.reflectorSpacingWl;
    build.loop_center_height_mm = spec.reflectorSpacingWl * wavelength * MM_PER_M;
  }
  if (spec.reflector === REFLECTOR_RADIALS) {
    build.radials = {
      count: spec.radialCount,
      length_mm: spec.radialLengthWl * wavelength * MM_PER_M,
      droop_deg: spec.radialDroopDeg,
    };
  }
  const shape = spec.loopShape;
  const cornerRadiusM =
    shape === SHAPE_SQUIRCLE ? spec.cornerRadiusWl * wavelength : 0.0;
  if (shape === SHAPE_SQUIRCLE) {
    build.corner_radius_mm = cornerRadiusM * MM_PER_M;
  }
  build.loop = loopDims(result.baseFactor * wavelength, shape, cornerRadiusM);
  build.mesh = meshDict(result, wavelength);
  build.loop_offset_mm = spec.loopOffsetMm;
  build.feed_gap_mm = spec.feedGapMm;
  build.feed = spec.feed;
  let phasing: Coax;
  if (spec.feed === FEED_LINE) {
    phasing = phasingLineCoax(spec);
    build.phasing_line = {
      coax: coaxDict(phasing),
      length_mm: quarterWaveMm(wavelength, phasing),
      connection: result.crossedPhasingLine ? "crossed" : "normal",
    };
  } else {
    build.harness = harnessDict(result, wavelength);
    phasing = spec.feed === FEED_CHOKE ? CHOKE_PHASING_COAX : BALUN4_PHASING_COAX;
  }
  build.drive = driveDict(result, phasing.z0Ohm);
  build.match = matchDict(result, wavelength);
  return build;
}

function zOhm(z: Complex | null): JsonObject | null {
  return z !== null ? { real: z.re, imag: z.im } : null;
}

function performanceDict(result: DesignResult): JsonObject {
  const spec = result.spec;
  const z = result.zIn;
  const achieved = NEC_SENSE_TO_HAND[result.sense];
  return {
    feed_z_ohm: { real: z.re, imag: z.im },
    feed_z_kind: "feedpoint",
    vswr_unmatched: vswr(z, spec.systemZOhm),
    vswr_matched: matchedVswr(spec, z),
    loop_current_phase_deg: result.phaseDiffDeg,
    loop_balance: result.loopBalance,
    loop_a_feed_z_ohm: zOhm(result.loopAFeedZ),
    loop_b_feed_z_ohm: zOhm(result.loopBFeedZ),
    sense: achieved ? achieved.toUpperCase() : result.sense,
    sense_requested: spec.sense.toUpperCase(),
    sense_achieved: achieved === spec.sense,
    axial_ratio_cone_db: result.arBoresightDb,
    axial_ratio_cone_worst_db: result.arConeWorstDb,
    axial_ratio_peak_db: result.arPeakDb,
    coverage_gain_dbi: result.coverageGainDb,
  };
}

// Serialize a tuned design's cut list and performance to a plain object. The
// optional frequency-sweep bandwidth section is added by bandwidthDict, which
// is async (it runs extra nec2c jobs); this function is synchronous.
export { arFloorDb };

export function resultToDict(result: DesignResult): JsonObject {
  return {
    spec: specToDict(result.spec),
    build: buildDict(result),
    performance: performanceDict(result),
  };
}

// Serialize results to JSON; a single result becomes an object, not a list.
export function resultsToJson(results: DesignResult[]): string {
  const payload = results.map(resultToDict);
  return JSON.stringify(payload.length === 1 ? payload[0] : payload, null, 2);
}
