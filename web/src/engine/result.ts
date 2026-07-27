// Structured, JSON-serializable view of a tuned design. Port of
// src/awadateki/result.py.
//
// resultToDict is the single source of the derived numbers: the build cut list
// (loop dimensions and matching hardware) and the predicted performance. The
// text cut sheet (report.ts) renders from this dict, so the numbers cannot
// diverge between outputs. Key insertion order mirrors the Python dicts so the
// JSON shape and order match.

import type { Coax } from "./coax";
import {
  BALUN4_BALUN_COAX,
  BALUN4_PHASING_COAX,
  BALUN4_Q_COAX,
  BALUN_LINE_WL,
  FEED_BALUN4,
  FEED_LINE,
  NEC_SENSE_TO_HAND,
  REFLECTOR_NONE,
  REFLECTOR_RADIALS,
  TURNSTILE_DELAY_COAX,
  TURNSTILE_Q_COAX,
} from "./constants";
import {
  type DesignResult,
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

// Harness pieces for the turnstile and balun4 feeds.
function harnessDict(result: DesignResult, wavelength: number): JsonObject {
  const connection = result.crossedPhasingLine ? "crossed" : "normal";
  if (result.spec.feed === FEED_BALUN4) {
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
  return {
    q_section: {
      coax: coaxDict(TURNSTILE_Q_COAX),
      length_mm: quarterWaveMm(wavelength, TURNSTILE_Q_COAX),
      count: 2,
    },
    delay_line: {
      coax: coaxDict(TURNSTILE_DELAY_COAX),
      length_mm: quarterWaveMm(wavelength, TURNSTILE_DELAY_COAX),
    },
    balun: { kind: "1:1 current choke" },
    connection,
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
  build.loop_offset_mm = spec.loopOffsetMm;
  build.feed_gap_mm = spec.feedGapMm;
  build.feed = spec.feed;
  if (spec.feed === FEED_LINE) {
    build.phasing_line = {
      coax: coaxDict(phasingLineCoax(spec)),
      length_mm: quarterWaveMm(wavelength, phasingLineCoax(spec)),
      connection: result.crossedPhasingLine ? "crossed" : "normal",
    };
  } else {
    build.harness = harnessDict(result, wavelength);
  }
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
