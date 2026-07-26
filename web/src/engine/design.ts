// Design orchestration: build geometry, drive nec2c, tune to quadrature.
// Port of the design core of src/awadateki/design.py.
//
// Two equal resonant loops are driven with their currents 90 deg apart for
// circular polarization, by one of three coax feed harnesses (spec.feed): the
// source at the junction with a quarter-wave line to loop B (line), a Q-section
// per loop paralleled at a port with a delay line in loop B's leg (turnstile),
// or the ON6WG/F5VIF balanced system (balun4). Harness lines are NEC TL cards;
// crossing loop B's connection (negative Z0) reverses the handedness.
//
// The nec2c runner is threaded in explicitly (async, since a WASM run is async):
// design(spec, runner), analyze(spec, factor, options, runner). No globals.

import type { Coax } from "./coax";
import { nearestStandardCoax } from "./coax";
import { equivalentRadiusM } from "./conductor";
import {
  AR_PENALTY_PER_DB,
  AR_TARGET_DB,
  BALUN4_BALUN_COAX,
  BALUN4_PHASING_COAX,
  BALUN4_Q_COAX,
  BORESIGHT_THETA_DEG,
  COVERAGE_THETA_DEG,
  DROOP_BOUNDS_DEG,
  DROOP_TOLERANCE_DEG,
  FACTOR_BOUNDS,
  FEASIBLE_VSWR,
  FEED_BALUN4,
  FEED_LINE,
  FEED_TURNSTILE,
  GOLDEN_RATIO,
  HZ_PER_MHZ,
  LINE_PHASING_COAX,
  MATCH_REACTANCE_WARN_OHMS,
  NEC_SENSE_TO_HAND,
  NULL_GAIN_DB,
  PHASE_TOLERANCE_DEG,
  PHASING_LINE_WL,
  PLACEMENT_SWEEPS,
  PORT_RADIUS_M,
  PORT_SEGMENT_LENGTH_M,
  PORT_SPACING_M,
  PORT_TAG_BASE,
  RADIAL_COUNT_GRID,
  RADIAL_SEGMENT_WL,
  REFERENCE_IMPEDANCE_OHMS,
  REFLECTOR_GROUND,
  REFLECTOR_RADIALS,
  SENSE_PROBE_FACTOR,
  SOLVER_MAX_ITERATIONS,
  SPACING_BOUNDS_WL,
  SPACING_TOLERANCE_WL,
  SWEEP_POINTS,
  SWEEP_SPAN_FRACTION,
  TURNSTILE_DELAY_COAX,
  TURNSTILE_Q_COAX,
} from "./constants";
import { formatG } from "./format";
import {
  type Eggbeater,
  LOOP_A_TAG_BASE,
  LOOP_B_TAG_BASE,
  type Wire,
  loopRadiusM,
  makeEggbeater,
  makeRadials,
  wavelengthM,
} from "./geometry";
import type { Complex } from "./nec";
import {
  type NecResult,
  type NecRunner,
  type PatternPoint,
  type RadiationGrid,
  type Source,
  type TransmissionLine,
  buildDeck,
  feedCurrent,
  parseOutput,
} from "./nec";
import type { DesignSpec } from "./spec";
import { validateSpec } from "./validate";

// Upper-hemisphere sampling grid: theta 0..80 deg, phi 0..90 deg.
export const DEFAULT_GRID: RadiationGrid = {
  ntheta: 9,
  nphi: 7,
  theta0: 0.0,
  phi0: 0.0,
  dtheta: 10.0,
  dphi: 15.0,
};

// Tuned design and its predicted performance (mirrors the Python DesignResult).
//   spec: the originating DesignSpec.
//   baseFactor: tuned loop perimeter (currents in quadrature) as a multiple of
//     wavelength.
//   zIn: predicted feedpoint impedance at the harness source, before the match.
//   phaseDiffDeg: loop current phase difference (loop A minus loop B), wrapped
//     to [-180, 180), for the delivered line connection.
//   loopBalance: loop current magnitude ratio |I_B| / |I_A| (1.0 is balanced).
//   crossedPhasingLine: whether the phasing line is connected crossed.
//   sense: achieved polarization sense (nec2c vocabulary, e.g. RIGHT).
//   arBoresightDb: mean axial ratio over the high-elevation coverage cone.
//   arConeWorstDb: worst axial ratio over the same cone (dB).
//   arPeakDb: axial ratio at the pattern peak (dB).
//   coverageGainDb: worst-case total gain over the coverage cone (dBi).
//   deck: the tuned NEC deck text (with the chosen line connection).
export interface DesignResult {
  spec: DesignSpec;
  baseFactor: number;
  zIn: Complex;
  phaseDiffDeg: number;
  loopBalance: number;
  crossedPhasingLine: boolean;
  sense: string;
  arBoresightDb: number;
  arConeWorstDb: number;
  arPeakDb: number;
  coverageGainDb: number;
  deck: string;
}

// One frequency-sweep sample.
export interface SweepPoint {
  freqMhz: number;
  vswr: number;
  arDb: number;
}

// Options for a single analysis run.
export interface AnalyzeOptions {
  flip?: boolean;
  runFreqMhz?: number | null;
  grid?: RadiationGrid | null;
}

// A parsed nec2c run paired with the deck it came from.
export interface AnalyzeResult {
  result: NecResult;
  deck: string;
}

// The feed harness for a scheme: port wires, sources, and TL cards.
interface Harness {
  ports: Wire[];
  sources: Source[];
  lines: TransmissionLine[];
}

// --- Complex arithmetic (Python's complex, as {re, im}). ---

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cScale(s: number, a: Complex): Complex {
  return { re: s * a.re, im: s * a.im };
}

function cDiv(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

// Python modulo (result carries the sign of the divisor).
function pythonMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

// Python round(): round half to even.
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) {
    return floor;
  }
  if (diff > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

// --- Geometry / deck assembly. ---

function centerZM(spec: DesignSpec, wavelength: number, perimeterM: number): number {
  if (spec.reflector === REFLECTOR_GROUND || spec.reflector === REFLECTOR_RADIALS) {
    // Loop centre sits the given spacing above the reflector plane (z = 0).
    return spec.reflectorSpacingWl * wavelength;
  }
  // In free space the absolute height is irrelevant; keep the loop above the
  // origin for readable coordinates.
  return loopRadiusM(perimeterM);
}

function reflectorWires(spec: DesignSpec, wavelength: number): Wire[] {
  if (spec.reflector !== REFLECTOR_RADIALS) {
    return [];
  }
  const lengthM = spec.radialLengthWl * wavelength;
  const segmentsPerRadial = Math.max(
    1,
    pyRound(spec.radialLengthWl / RADIAL_SEGMENT_WL),
  );
  return makeRadials(
    spec.radialCount,
    lengthM,
    0.0,
    spec.radialDroopDeg,
    equivalentRadiusM(spec.conductor),
    segmentsPerRadial,
  );
}

function commentLines(spec: DesignSpec): string[] {
  return [
    "Eggbeater antenna (crossed full-wave loops)",
    `freq ${formatGeneral(spec.freqMhz)} MHz, reflector ${spec.reflector}`,
    `conductor: ${spec.conductor.description}, ` +
      `equiv radius ${format4g(spec.conductor.equivalentRadiusMm)} mm`,
  ];
}

export function phasingLineCoax(spec: DesignSpec): Coax {
  return spec.phasingCoax ?? LINE_PHASING_COAX;
}

// Tiny isolated wire at the loop centre hosting harness TL ports. The two ports
// (index 0, 1) straddle the loop centre symmetrically.
function portWire(tag: number, segments: number, cz: number, index: number): Wire {
  const half = (PORT_SEGMENT_LENGTH_M * segments) / 2.0;
  const z = cz + (index - 0.5) * PORT_SPACING_M;
  return {
    tag,
    segments,
    x1: -half,
    y1: 0.0,
    z1: z,
    x2: half,
    y2: 0.0,
    z2: z,
    radiusM: PORT_RADIUS_M,
  };
}

function feedLine(
  egg: Eggbeater,
  spec: DesignSpec,
  wavelength: number,
  flip: boolean,
): Harness {
  const source: Source = {
    tag: egg.loopA.feedTag,
    segment: egg.loopA.feedSegment,
    vReal: 1.0,
    vImag: 0.0,
  };
  const z0 = phasingLineCoax(spec).z0Ohm;
  const line: TransmissionLine = {
    tag1: egg.loopA.feedTag,
    segment1: egg.loopA.feedSegment,
    tag2: egg.loopB.feedTag,
    segment2: egg.loopB.feedSegment,
    z0Ohm: flip ? -z0 : z0,
    lengthM: PHASING_LINE_WL * wavelength,
  };
  return { ports: [], sources: [source], lines: [line] };
}

function feedTurnstile(
  egg: Eggbeater,
  wavelength: number,
  flip: boolean,
  cz: number,
): Harness {
  const port = portWire(PORT_TAG_BASE, 1, cz, 0);
  const mid = portWire(PORT_TAG_BASE + 1, 1, cz, 1);
  const quarter = PHASING_LINE_WL * wavelength;
  const qZ0 = TURNSTILE_Q_COAX.z0Ohm;
  const lines: TransmissionLine[] = [
    {
      tag1: port.tag,
      segment1: 1,
      tag2: egg.loopA.feedTag,
      segment2: egg.loopA.feedSegment,
      z0Ohm: qZ0,
      lengthM: quarter,
    },
    {
      tag1: port.tag,
      segment1: 1,
      tag2: mid.tag,
      segment2: 1,
      z0Ohm: TURNSTILE_DELAY_COAX.z0Ohm,
      lengthM: quarter,
    },
    {
      tag1: mid.tag,
      segment1: 1,
      tag2: egg.loopB.feedTag,
      segment2: egg.loopB.feedSegment,
      z0Ohm: flip ? -qZ0 : qZ0,
      lengthM: quarter,
    },
  ];
  const source: Source = { tag: port.tag, segment: 1, vReal: 1.0, vImag: 0.0 };
  return { ports: [port, mid], sources: [source], lines };
}

function feedBalun4(egg: Eggbeater, wavelength: number, flip: boolean): Harness {
  const source: Source = {
    tag: egg.loopA.feedTag,
    segment: egg.loopA.feedSegment,
    vReal: 1.0,
    vImag: 0.0,
  };
  const z0 = BALUN4_PHASING_COAX.z0Ohm;
  const line: TransmissionLine = {
    tag1: egg.loopA.feedTag,
    segment1: egg.loopA.feedSegment,
    tag2: egg.loopB.feedTag,
    segment2: egg.loopB.feedSegment,
    z0Ohm: flip ? -z0 : z0,
    lengthM: PHASING_LINE_WL * wavelength,
  };
  return { ports: [], sources: [source], lines: [line] };
}

function harness(
  egg: Eggbeater,
  spec: DesignSpec,
  wavelength: number,
  flip: boolean,
  cz: number,
): Harness {
  if (spec.feed === FEED_LINE) {
    return feedLine(egg, spec, wavelength, flip);
  }
  if (spec.feed === FEED_TURNSTILE) {
    return feedTurnstile(egg, wavelength, flip, cz);
  }
  if (spec.feed === FEED_BALUN4) {
    return feedBalun4(egg, wavelength, flip);
  }
  throw new Error(`unknown feed scheme: ${JSON.stringify(spec.feed)}`);
}

function buildEggbeater(
  spec: DesignSpec,
  factor: number,
): { egg: Eggbeater; wavelength: number } {
  validateSpec(spec);
  const wavelength = wavelengthM(spec.freqMhz);
  const perimeter = factor * wavelength;
  const cz = centerZM(spec, wavelength, perimeter);
  const egg = makeEggbeater(
    perimeter,
    perimeter,
    cz,
    equivalentRadiusM(spec.conductor),
    spec.segments,
    spec.loopShape,
    spec.cornerRadiusWl * wavelength,
    spec.loopOffsetMm / 1000.0,
    spec.feedGapMm / 1000.0,
  );
  return { egg, wavelength };
}

// Emit the NEC-2 deck text for a perimeter factor and line connection.
export function buildDeckText(
  spec: DesignSpec,
  factor: number,
  flip: boolean,
  runFreqMhz: number | null,
  grid: RadiationGrid | null,
): string {
  const { egg, wavelength } = buildEggbeater(spec, factor);
  const cz = centerZM(spec, wavelength, factor * wavelength);
  const parts = harness(egg, spec, wavelength, flip, cz);
  const wires = [...egg.wires, ...parts.ports, ...reflectorWires(spec, wavelength)];
  return buildDeck(
    commentLines(spec),
    wires,
    parts.sources,
    spec.reflector === REFLECTOR_GROUND,
    runFreqMhz !== null ? runFreqMhz : spec.freqMhz,
    grid !== null ? grid : DEFAULT_GRID,
    parts.lines,
  );
}

// Run nec2c once for the given loop perimeter and line connection.
export async function analyze(
  spec: DesignSpec,
  factor: number,
  options: AnalyzeOptions,
  runner: NecRunner,
): Promise<AnalyzeResult> {
  const flip = options.flip ?? false;
  const runFreqMhz = options.runFreqMhz ?? null;
  const grid = options.grid ?? null;
  const deck = buildDeckText(spec, factor, flip, runFreqMhz, grid);
  const output = await runner(deck);
  return { result: parseOutput(output), deck };
}

// --- Solvers (async objective functions). ---

async function secant(
  func: (x: number) => Promise<number>,
  x0In: number,
  x1In: number,
  bounds: [number, number],
  tolerance: number,
): Promise<number> {
  const [low, high] = bounds;
  let x0 = x0In;
  let x1 = x1In;
  let f0 = await func(x0);
  let f1 = await func(x1);
  for (let i = 0; i < SOLVER_MAX_ITERATIONS; i++) {
    if (Math.abs(f1) <= tolerance) {
      return x1;
    }
    const denom = f1 - f0;
    if (denom === 0.0) {
      return x1;
    }
    let x2 = x1 - (f1 * (x1 - x0)) / denom;
    x2 = Math.min(Math.max(x2, low), high);
    x0 = x1;
    f0 = f1;
    x1 = x2;
    f1 = await func(x2);
  }
  return x1;
}

async function goldenSectionMin(
  func: (x: number) => Promise<number>,
  lowIn: number,
  highIn: number,
  tolerance: number,
): Promise<number> {
  let low = lowIn;
  let high = highIn;
  let x1 = high - GOLDEN_RATIO * (high - low);
  let x2 = low + GOLDEN_RATIO * (high - low);
  let f1 = await func(x1);
  let f2 = await func(x2);
  while (high - low > tolerance) {
    if (f1 < f2) {
      high = x2;
      x2 = x1;
      f2 = f1;
      x1 = high - GOLDEN_RATIO * (high - low);
      f1 = await func(x1);
    } else {
      low = x1;
      x1 = x2;
      f1 = f2;
      x2 = low + GOLDEN_RATIO * (high - low);
      f2 = await func(x2);
    }
  }
  return (low + high) / 2.0;
}

export async function quadratureFactor(
  spec: DesignSpec,
  flip: boolean,
  runner: NecRunner,
): Promise<number> {
  const phaseError = async (factor: number): Promise<number> => {
    const { result } = await analyze(spec, factor, { flip }, runner);
    return Math.abs(phaseDifference(result)) - 90.0;
  };
  return secant(phaseError, 1.0, 1.05, FACTOR_BOUNDS, PHASE_TOLERANCE_DEG);
}

// --- Pattern and current metrics. ---

function loopCurrents(result: NecResult): [Complex, Complex] {
  return [feedCurrent(result, LOOP_A_TAG_BASE), feedCurrent(result, LOOP_B_TAG_BASE)];
}

export function wrapPhaseDeg(angle: number): number {
  return pythonMod(angle + 180.0, 360.0) - 180.0;
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

export function axialRatioDb(axialRatio: number): number {
  if (axialRatio <= 0.0) {
    return Number.POSITIVE_INFINITY;
  }
  return -20.0 * Math.log10(axialRatio);
}

// Usable pattern points within thetaMaxDeg of zenith; the theta = 0 direction
// is kept only once (it is emitted per azimuth column).
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

// Cone mean and worst axial ratio (dB), peak axial ratio (dB), boresight sense.
function polarizationSummary(result: NecResult): [number, number, number, string] {
  const usable = result.pattern.filter((p) => p.totalGainDb > NULL_GAIN_DB);
  if (usable.length === 0) {
    const inf = Number.POSITIVE_INFINITY;
    return [inf, inf, inf, "UNKNOWN"];
  }
  let peak = usable[0] as PatternPoint;
  for (const p of usable) {
    if (p.totalGainDb > peak.totalGainDb) {
      peak = p;
    }
  }
  return [
    boresightArDb(result),
    coneWorstArDb(result),
    axialRatioDb(peak.axialRatio),
    boresightSense(result),
  ];
}

// --- Matching math. ---

export function vswr(z: Complex, reference: number = REFERENCE_IMPEDANCE_OHMS): number {
  if (z.re === -reference && z.im === 0.0) {
    return Number.POSITIVE_INFINITY;
  }
  const num = { re: z.re - reference, im: z.im };
  const den = { re: z.re + reference, im: z.im };
  const gamma = cAbs(cDiv(num, den));
  if (gamma >= 1.0) {
    return Number.POSITIVE_INFINITY;
  }
  return (1.0 + gamma) / (1.0 - gamma);
}

export function quarterWaveMatchZ0(
  z: Complex,
  reference: number = REFERENCE_IMPEDANCE_OHMS,
): number {
  return Math.sqrt(reference * z.re);
}

export function transformerCoax(
  z: Complex,
  reference: number = REFERENCE_IMPEDANCE_OHMS,
  override: Coax | null = null,
): Coax {
  return override ?? nearestStandardCoax(quarterWaveMatchZ0(z, reference));
}

export function seriesElementFitted(z: Complex): boolean {
  return Math.abs(z.im) > MATCH_REACTANCE_WARN_OHMS;
}

// Series element that cancels the feedpoint reactance: [kind, value] in henries
// (inductor) or farads (capacitor).
export function seriesMatchElement(z: Complex, freqMhz: number): [string, number] {
  const omega = 2.0 * Math.PI * freqMhz * HZ_PER_MHZ;
  if (z.im > 0.0) {
    return ["capacitor", 1.0 / (omega * z.im)];
  }
  return ["inductor", -z.im / omega];
}

export function postMatchVswr(
  z: Complex,
  reference: number = REFERENCE_IMPEDANCE_OHMS,
  coax: Coax | null = null,
): number {
  if (z.re <= 0.0) {
    return Number.POSITIVE_INFINITY;
  }
  const z0 = transformerCoax(z, reference, coax).z0Ohm;
  const load = seriesElementFitted(z) ? { re: z.re, im: 0.0 } : z;
  return vswr(cDiv({ re: z0 * z0, im: 0.0 }, load), reference);
}

export function lineInputZ(zLoad: Complex, z0: number, theta: number): Complex {
  const tanTheta = Math.tan(theta);
  const num = { re: zLoad.re, im: zLoad.im + z0 * tanTheta };
  const den = { re: z0 - zLoad.im * tanTheta, im: zLoad.re * tanTheta };
  return cScale(z0, cDiv(num, den));
}

export function quarterWaveTheta(freqMhz: number, designFreqMhz: number): number {
  return (Math.PI / 2.0) * (freqMhz / designFreqMhz);
}

export function balun4RadioZ(
  zJunction: Complex,
  freqMhz: number,
  designFreqMhz: number,
): Complex {
  const thetaQ = quarterWaveTheta(freqMhz, designFreqMhz);
  const zBal = lineInputZ(zJunction, BALUN4_Q_COAX.z0Ohm, thetaQ);
  const half = cScale(0.5, zBal);
  const zViaLine = lineInputZ(half, BALUN4_BALUN_COAX.z0Ohm, 2.0 * thetaQ);
  return cDiv(cMul(half, zViaLine), cAdd(half, zViaLine));
}

export function matchedVswr(spec: DesignSpec, z: Complex): number {
  if (spec.feed === FEED_BALUN4) {
    if (z.re <= 0.0) {
      return Number.POSITIVE_INFINITY;
    }
    const zRadio = balun4RadioZ(z, spec.freqMhz, spec.freqMhz);
    return vswr(zRadio, spec.systemZOhm);
  }
  return postMatchVswr(z, spec.systemZOhm, spec.matchCoax);
}

export function matchedInputZ(
  zAnt: Complex,
  freqMhz: number,
  designFreqMhz: number,
  zCenter: Complex,
  systemZ: number,
  matchCoax: Coax | null,
): Complex {
  let zAfterSeries = zAnt;
  if (seriesElementFitted(zCenter)) {
    const omega = 2.0 * Math.PI * freqMhz * HZ_PER_MHZ;
    const [kind, value] = seriesMatchElement(zCenter, designFreqMhz);
    const reactance = kind === "inductor" ? omega * value : -1.0 / (omega * value);
    zAfterSeries = { re: zAnt.re, im: zAnt.im + reactance };
  }
  const z0 = transformerCoax(zCenter, systemZ, matchCoax).z0Ohm;
  const theta = quarterWaveTheta(freqMhz, designFreqMhz);
  return lineInputZ(zAfterSeries, z0, theta);
}

// --- Design driver. ---

async function naturalHand(
  spec: DesignSpec,
  runner: NecRunner,
): Promise<string | null> {
  const { result } = await analyze(spec, SENSE_PROBE_FACTOR, {}, runner);
  return NEC_SENSE_TO_HAND[boresightSense(result)] ?? null;
}

export async function design(
  spec: DesignSpec,
  runner: NecRunner,
): Promise<DesignResult> {
  const natural = await naturalHand(spec, runner);
  const crossed = natural !== null && natural !== spec.sense;
  const baseFactor = await quadratureFactor(spec, crossed, runner);
  const { result, deck } = await analyze(spec, baseFactor, { flip: crossed }, runner);
  const [arBoresight, arWorst, arPeak, sense] = polarizationSummary(result);
  return {
    spec,
    baseFactor,
    zIn: antennaFeedZ(result),
    phaseDiffDeg: phaseDifference(result),
    loopBalance: loopBalance(result),
    crossedPhasingLine: crossed,
    sense,
    arBoresightDb: arBoresight,
    arConeWorstDb: arWorst,
    arPeakDb: arPeak,
    coverageGainDb: coverageGainDb(result),
    deck,
  };
}

// The loop's feed wire (the one carrying the source/line connection).
function feedWire(loop: { wires: Wire[]; feedTag: number }): Wire {
  const wire = loop.wires.find((w) => w.tag === loop.feedTag);
  if (wire === undefined) {
    throw new Error(`no wire with tag ${loop.feedTag} in loop`);
  }
  return wire;
}

// Reconstruct the tuned wire model and the two loop feed points.
//
// Built from the same geometry call as analyze(), so a 3-D view matches the
// deck without parsing it. Returns the loop and reflector wires and the feed
// points (midpoint of each loop's bottom feed wire), in metres.
export function tunedGeometry(result: DesignResult): {
  wires: Wire[];
  feeds: Array<[number, number, number]>;
} {
  const { egg, wavelength } = buildEggbeater(result.spec, result.baseFactor);
  const wires = [...egg.wires, ...reflectorWires(result.spec, wavelength)];
  const feeds: Array<[number, number, number]> = [egg.loopA, egg.loopB].map((loop) => {
    const w = feedWire(loop);
    return [(w.x1 + w.x2) / 2.0, (w.y1 + w.y2) / 2.0, (w.z1 + w.z2) / 2.0];
  });
  return { wires, feeds };
}

// --- Reflector optimizer. ---

function reflectorCost(result: DesignResult): number {
  const spec = result.spec;
  const budget = AR_TARGET_DB - spec.arMarginDb;
  const excess = Math.max(0.0, result.arBoresightDb - budget);
  return matchedVswr(spec, result.zIn) + AR_PENALTY_PER_DB * excess;
}

function reflectorFeasible(result: DesignResult): boolean {
  const spec = result.spec;
  return (
    result.arBoresightDb <= AR_TARGET_DB - spec.arMarginDb &&
    matchedVswr(spec, result.zIn) <= FEASIBLE_VSWR
  );
}

async function bestPlacement(
  spec: DesignSpec,
  count: number,
  optimizeDroop: boolean,
  runner: NecRunner,
): Promise<{ cost: number; candidate: DesignSpec; result: DesignResult }> {
  const costOf = async (spacing: number, droop: number): Promise<number> => {
    const candidate: DesignSpec = {
      ...spec,
      radialCount: count,
      reflectorSpacingWl: spacing,
      radialDroopDeg: droop,
      optimization: null,
    };
    return reflectorCost(await design(candidate, runner));
  };

  let spacing = (SPACING_BOUNDS_WL[0] + SPACING_BOUNDS_WL[1]) / 2.0;
  let droop = optimizeDroop ? (DROOP_BOUNDS_DEG[0] + DROOP_BOUNDS_DEG[1]) / 2.0 : 0.0;
  for (let sweep = 0; sweep < PLACEMENT_SWEEPS; sweep++) {
    const droopAt = droop;
    spacing = await goldenSectionMin(
      (s) => costOf(s, droopAt),
      SPACING_BOUNDS_WL[0],
      SPACING_BOUNDS_WL[1],
      SPACING_TOLERANCE_WL,
    );
    if (optimizeDroop) {
      const spacingAt = spacing;
      droop = await goldenSectionMin(
        (d) => costOf(spacingAt, d),
        DROOP_BOUNDS_DEG[0],
        DROOP_BOUNDS_DEG[1],
        DROOP_TOLERANCE_DEG,
      );
    }
  }

  const candidate: DesignSpec = {
    ...spec,
    radialCount: count,
    reflectorSpacingWl: spacing,
    radialDroopDeg: droop,
    optimization: null,
  };
  const result = await design(candidate, runner);
  return { cost: reflectorCost(result), candidate, result };
}

export async function optimizeReflector(
  spec: DesignSpec,
  runner: NecRunner,
): Promise<DesignSpec> {
  const radials = spec.reflector === REFLECTOR_RADIALS;
  const counts = [...(radials ? RADIAL_COUNT_GRID : [spec.radialCount])].sort(
    (a, b) => a - b,
  );
  const start = performance.now();

  let chosen: DesignSpec | null = null;
  let fallback: { cost: number; candidate: DesignSpec } | null = null;
  for (const count of counts) {
    const { cost, candidate, result } = await bestPlacement(
      spec,
      count,
      radials,
      runner,
    );
    if (fallback === null || cost < fallback.cost) {
      fallback = { cost, candidate };
    }
    if (reflectorFeasible(result)) {
      chosen = candidate;
      break;
    }
  }
  const bestSpec =
    chosen !== null ? chosen : (fallback as { candidate: DesignSpec }).candidate;

  const elapsedS = Math.round(performance.now() - start) / 1000.0;
  return {
    ...bestSpec,
    optimization: {
      input: { ...spec, optimization: null },
      method: "coordinate descent (golden-section per axis)",
      spacingBoundsWl: [...SPACING_BOUNDS_WL],
      droopBoundsDeg: radials ? [...DROOP_BOUNDS_DEG] : [0.0, 0.0],
      spacingToleranceWl: SPACING_TOLERANCE_WL,
      droopToleranceDeg: radials ? DROOP_TOLERANCE_DEG : 0.0,
      sweeps: PLACEMENT_SWEEPS,
      radialCountGrid: counts,
      arTargetDb: AR_TARGET_DB,
      arMarginDb: spec.arMarginDb,
      arPenaltyPerDb: AR_PENALTY_PER_DB,
      feasibleVswr: FEASIBLE_VSWR,
      objective: "fewest radials meeting AR and VSWR, then minimize match cost",
      elapsedS,
    },
  };
}

// --- Frequency sweep and bandwidth. ---

export async function frequencySweep(
  result: DesignResult,
  runner: NecRunner,
  spanFraction: number = SWEEP_SPAN_FRACTION,
  points: number = SWEEP_POINTS,
): Promise<SweepPoint[]> {
  const spec = result.spec;
  const designFreq = spec.freqMhz;
  const base = result.baseFactor;
  const low = designFreq * (1.0 - spanFraction);
  const high = designFreq * (1.0 + spanFraction);
  const sweep: SweepPoint[] = [];
  for (let i = 0; i < points; i++) {
    const freq = low + ((high - low) * i) / (points - 1);
    const { result: nec } = await analyze(spec, base, { runFreqMhz: freq }, runner);
    const zAnt = antennaFeedZ(nec);
    let zIn: Complex;
    if (spec.feed === FEED_BALUN4) {
      zIn = balun4RadioZ(zAnt, freq, designFreq);
    } else {
      zIn = matchedInputZ(
        zAnt,
        freq,
        designFreq,
        result.zIn,
        spec.systemZOhm,
        spec.matchCoax,
      );
    }
    sweep.push({
      freqMhz: freq,
      vswr: vswr(zIn, spec.systemZOhm),
      arDb: boresightArDb(nec),
    });
  }
  return sweep;
}

// Contiguous frequency band around the centre where value <= limit, edges
// linearly interpolated; null if the centre already exceeds the limit.
export function bandwidthWithin(
  pairs: Array<[number, number]>,
  limit: number,
): [number, number] | null {
  const center = Math.floor(pairs.length / 2);
  const centerPair = pairs[center];
  if (centerPair === undefined || centerPair[1] > limit) {
    return null;
  }

  const edge = (indices: number[]): number => {
    let previous = center;
    for (const i of indices) {
      const pair = pairs[i];
      if (pair === undefined) {
        continue;
      }
      const [freq, value] = pair;
      if (value > limit) {
        const prev = pairs[previous] as [number, number];
        const frac = (limit - prev[1]) / (value - prev[1]);
        return prev[0] + (freq - prev[0]) * frac;
      }
      previous = i;
    }
    const lastIndex = indices[indices.length - 1] as number;
    return (pairs[lastIndex] as [number, number])[0];
  };

  const lowIndices: number[] = [];
  for (let i = center - 1; i >= 0; i--) {
    lowIndices.push(i);
  }
  const highIndices: number[] = [];
  for (let i = center + 1; i < pairs.length; i++) {
    highIndices.push(i);
  }
  return [edge(lowIndices), edge(highIndices)];
}

// --- Local number formatting for the deck comment lines. ---

// Python "%g".
function formatGeneral(x: number): string {
  return formatG(x, 6);
}

// Python "%.4g".
function format4g(x: number): string {
  return formatG(x, 4);
}
