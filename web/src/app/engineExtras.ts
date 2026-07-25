// Engine-adjacent helpers the UI consumes.
//
// The engine wave has landed the plot-data collectors (chartData / skyData /
// tunedGeometry) and the schematic renderer; the UI now uses them directly and
// this module only re-exports them plus the couple of things that are genuinely
// UI-side:
//   - analyzeLiteral: Analyze must evaluate a literal (hand-entered / estimated)
//     loop perimeter without re-tuning, and the engine's design() always solves
//     for quadrature, so the small pattern/current metrics are reconstructed
//     here against exported primitives.
//   - the closed-form perimeter estimate and perimeter<->factor conversion.
//   - wireColorIndex for the 3-D viewer palette.

import {
  BORESIGHT_THETA_DEG,
  COVERAGE_THETA_DEG,
  type Complex,
  type DesignResult,
  type DesignSpec,
  LOOP_A_TAG_BASE,
  LOOP_B_TAG_BASE,
  NEC_SENSE_TO_HAND,
  NULL_GAIN_DB,
  type NecResult,
  type NecRunner,
  type PatternPoint,
  RADIAL_TAG_BASE,
  SENSE_PROBE_FACTOR,
  analyze,
  axialRatioDb,
  feedCurrent,
  wavelengthM,
  wrapPhaseDeg,
} from "../engine/index";

// Re-export the engine collectors and their data shapes under the names the UI
// codes against.
export {
  type ChartData,
  type SkyData,
  AR_MAP_MAX_DB,
  GAIN_MAP_RANGE_DB,
  chartData,
  skyData,
  tunedGeometry,
} from "../engine/index";

// --- Local reproductions of design.ts module-private metrics (analyzeLiteral). ---

function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

function loopCurrents(result: NecResult): [Complex, Complex] {
  return [feedCurrent(result, LOOP_A_TAG_BASE), feedCurrent(result, LOOP_B_TAG_BASE)];
}

function phaseDifference(result: NecResult): number {
  const [ia, ib] = loopCurrents(result);
  const pa = (Math.atan2(ia.im, ia.re) * 180.0) / Math.PI;
  const pb = (Math.atan2(ib.im, ib.re) * 180.0) / Math.PI;
  return wrapPhaseDeg(pa - pb);
}

function loopBalance(result: NecResult): number {
  const [ia, ib] = loopCurrents(result);
  return cAbs(ia) > 0.0 ? cAbs(ib) / cAbs(ia) : Number.POSITIVE_INFINITY;
}

function antennaFeedZ(result: NecResult): Complex {
  const source = result.sources[0];
  if (source === undefined) {
    throw new Error("nec2c reported no source impedance");
  }
  return { re: source.zReal, im: source.zImag };
}

function conePoints(result: NecResult, thetaMaxDeg: number): PatternPoint[] {
  const cone: PatternPoint[] = [];
  let seenZenith = false;
  for (const p of result.pattern) {
    if (p.thetaDeg > thetaMaxDeg || p.totalGainDb <= NULL_GAIN_DB) {
      continue;
    }
    if (p.thetaDeg === 0.0) {
      if (seenZenith) {
        continue;
      }
      seenZenith = true;
    }
    cone.push(p);
  }
  return cone;
}

function boresightArDb(result: NecResult): number {
  const cone = conePoints(result, BORESIGHT_THETA_DEG);
  if (cone.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let sum = 0.0;
  for (const p of cone) {
    sum += axialRatioDb(p.axialRatio);
  }
  return sum / cone.length;
}

function coneWorstArDb(result: NecResult): number {
  const cone = conePoints(result, BORESIGHT_THETA_DEG);
  if (cone.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let worst = Number.NEGATIVE_INFINITY;
  for (const p of cone) {
    worst = Math.max(worst, axialRatioDb(p.axialRatio));
  }
  return worst;
}

function coverageGainDb(result: NecResult): number {
  const cone = conePoints(result, COVERAGE_THETA_DEG);
  if (cone.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  let lowest = Number.POSITIVE_INFINITY;
  for (const p of cone) {
    lowest = Math.min(lowest, p.totalGainDb);
  }
  return lowest;
}

function boresightSense(result: NecResult): string {
  const cone = conePoints(result, BORESIGHT_THETA_DEG);
  if (cone.length === 0) {
    return "UNKNOWN";
  }
  let best = cone[0] as PatternPoint;
  let bestAr = axialRatioDb(best.axialRatio);
  for (const p of cone) {
    const ar = axialRatioDb(p.axialRatio);
    if (ar < bestAr) {
      best = p;
      bestAr = ar;
    }
  }
  return best.sense;
}

function peakArDb(result: NecResult): number {
  const usable = result.pattern.filter((p) => p.totalGainDb > NULL_GAIN_DB);
  if (usable.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let peak = usable[0] as PatternPoint;
  for (const p of usable) {
    if (p.totalGainDb > peak.totalGainDb) {
      peak = p;
    }
  }
  return axialRatioDb(peak.axialRatio);
}

// The perimeter factor (loop perimeter / wavelength) for a literal perimeter.
export function factorForPerimeter(perimeterMm: number, freqMhz: number): number {
  return perimeterMm / 1000.0 / wavelengthM(freqMhz);
}

// The closed-form full-wave perimeter estimate (mm): 1.05 * wavelength. Mirrors
// the mockup's live `est` formula.
export const ESTIMATE_PERIMETER_FACTOR = 1.05;
export function estimatePerimeterMm(freqMhz: number): number {
  return ESTIMATE_PERIMETER_FACTOR * wavelengthM(freqMhz) * 1000.0;
}

// Evaluate a design at a literal perimeter factor -- no perimeter solving, the
// spirit of Analyze. The delivered line connection (normal/crossed) is chosen
// from a coarse handedness probe, matching design(). Returns a full
// DesignResult so report.ts / result.ts / schematic.ts render it unchanged.
export async function analyzeLiteral(
  spec: DesignSpec,
  factor: number,
  runner: NecRunner,
): Promise<DesignResult> {
  const probe = await analyze(spec, SENSE_PROBE_FACTOR, {}, runner);
  const natural = NEC_SENSE_TO_HAND[boresightSense(probe.result)] ?? null;
  const crossed = natural !== null && natural !== spec.sense;
  const { result, deck } = await analyze(spec, factor, { flip: crossed }, runner);
  return {
    spec,
    baseFactor: factor,
    zIn: antennaFeedZ(result),
    phaseDiffDeg: phaseDifference(result),
    loopBalance: loopBalance(result),
    crossedPhasingLine: crossed,
    sense: boresightSense(result),
    arBoresightDb: boresightArDb(result),
    arConeWorstDb: coneWorstArDb(result),
    arPeakDb: peakArDb(result),
    coverageGainDb: coverageGainDb(result),
    deck,
  };
}

// 0 = loop A, 1 = loop B, 2 = reflector radial. Matches the viewer palette
// (ports plot.py _wire_color_index, which is engine-private).
export function wireColorIndex(tag: number): number {
  if (tag < LOOP_B_TAG_BASE) {
    return 0;
  }
  if (tag < RADIAL_TAG_BASE) {
    return 1;
  }
  return 2;
}
