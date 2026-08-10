// Chart-data collectors: the numbers behind the frequency-sweep line charts
// and the gain/axial-ratio az-el sky maps. Ported from the DATA half of the
// retired Python plot.py; its standalone HTML/SVG renderers were not carried
// over, since the UI draws these with its own React SVG components (see
// docs/web-ux.md). tunedGeometry (the wire model + loop feed points for the
// 3-D view) lives in design.ts, next to _eggbeater/analyze, since it needs
// design.ts's private geometry helpers -- see design.ts's tunedGeometry.

import { AR_TARGET_DB, NEC_SENSE_TO_HAND, VSWR_LIMIT } from "./constants";
import {
  type DesignResult,
  analyze,
  axialRatioDb,
  bandwidthWithin,
  frequencySweep,
  matchedVswr,
  pyRound,
} from "./design";
import { formatG } from "./format";
import type { NecRunner, RadiationGrid } from "./nec";

// Fine principal-plane (phi = 0) grid for elevation cuts, theta 0..90 deg.
export const FINE_GRID: RadiationGrid = {
  ntheta: 46,
  nphi: 1,
  theta0: 0.0,
  phi0: 0.0,
  dtheta: 2.0,
  dphi: 0.0,
};
// Full upper hemisphere for the az-el maps: theta 0..90 by 10, phi 0..360 by 15.
export const HEMI_GRID: RadiationGrid = {
  ntheta: 10,
  nphi: 25,
  theta0: 0.0,
  phi0: 0.0,
  dtheta: 10.0,
  dphi: 15.0,
};
export const HEMI_THETAS: readonly number[] = Array.from(
  { length: 10 },
  (_, i) => i * 10,
);
export const HEMI_PHIS: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => i * 15,
);
// Chart-only sweep parameters (distinct from design.ts's bandwidth-extraction
// defaults: plot.py names these the same but with a finer point count).
export const CHART_SWEEP_SPAN_FRACTION = 0.1;
export const CHART_SWEEP_POINTS = 61;
// Display clamps so near-linear horizon spikes stay on-axis.
export const AR_CLAMP_DB = 10.0;
export const VSWR_CLAMP = 3.0;
export const GAIN_FLOOR_DB = -50.0;
// Az-el map ranges: gain spans this many dB below the peak; AR clamps at this dB.
export const GAIN_MAP_RANGE_DB = 18.0;
export const AR_MAP_MAX_DB = 6.0;

// One (elevation deg, value) sample, elevation = 90 - theta.
export type ElevationPoint = [number, number];

// Frequency-sweep chart series and the design's binding bandwidth figures.
export interface ChartData {
  label: string;
  f0: number;
  z: { re: number; im: number };
  sense: string;
  vswrPost: number;
  arCone: number;
  covGain: number;
  vswrBand: [number, number] | null;
  arBand: [number, number] | null;
  // (percent offset from f0, clamped VSWR)
  vswrFreq: Array<[number, number]>;
  // (percent offset from f0, clamped AR dB)
  arFreq: Array<[number, number]>;
  arElev: ElevationPoint[];
  gainElev: ElevationPoint[];
}

function label(result: DesignResult): string {
  return result.spec.label || `${formatG(result.spec.freqMhz)} MHz`;
}

// Axial ratio and gain versus elevation on the phi=0 plane.
async function elevationCut(
  result: DesignResult,
  runner: NecRunner,
): Promise<{ ar: ElevationPoint[]; gain: ElevationPoint[] }> {
  const spec = result.spec;
  const base = result.baseFactor;
  const { result: nec } = await analyze(spec, base, { grid: FINE_GRID }, runner);
  const ar: ElevationPoint[] = [];
  const gain: ElevationPoint[] = [];
  for (const point of nec.pattern) {
    const elevation = 90.0 - point.thetaDeg;
    ar.push([elevation, Math.min(axialRatioDb(point.axialRatio), AR_CLAMP_DB)]);
    if (point.totalGainDb > GAIN_FLOOR_DB) {
      gain.push([elevation, point.totalGainDb]);
    }
  }
  ar.sort((a, b) => a[0] - b[0]);
  gain.sort((a, b) => a[0] - b[0]);
  return { ar, gain };
}

// Frequency-sweep chart series, the binding bandwidth figures, and the
// elevation cut, for one tuned design. Mirrors plot.py's _collect().
export async function chartData(
  result: DesignResult,
  runner: NecRunner,
): Promise<ChartData> {
  const spec = result.spec;
  const f0 = spec.freqMhz;
  const sweep = await frequencySweep(
    result,
    runner,
    CHART_SWEEP_SPAN_FRACTION,
    CHART_SWEEP_POINTS,
  );
  const vswrPairs: Array<[number, number]> = sweep.map((p) => [p.freqMhz, p.vswr]);
  const arPairs: Array<[number, number]> = sweep.map((p) => [p.freqMhz, p.arDb]);
  const { ar: arElev, gain: gainElev } = await elevationCut(result, runner);
  return {
    label: label(result),
    f0,
    z: result.zIn,
    sense: (NEC_SENSE_TO_HAND[result.sense] ?? result.sense).toUpperCase(),
    vswrPost: matchedVswr(result.spec, result.zIn),
    arCone: result.arBoresightDb,
    covGain: result.coverageGainDb,
    vswrBand: bandwidthWithin(vswrPairs, VSWR_LIMIT),
    arBand: bandwidthWithin(arPairs, AR_TARGET_DB),
    vswrFreq: vswrPairs.map(([f, v]) => [
      (100.0 * (f - f0)) / f0,
      Math.min(v, VSWR_CLAMP),
    ]),
    arFreq: arPairs.map(([f, a]) => [
      (100.0 * (f - f0)) / f0,
      Math.min(a, AR_CLAMP_DB),
    ]),
    arElev,
    gainElev,
  };
}

// Gain (dBi) and axial ratio (dB) over the upper hemisphere, keyed by
// "theta,phi" (phi taken modulo 360 so the 360 deg sample folds onto 0).
export interface SkyData {
  gainMap: Map<string, number>;
  arMap: Map<string, number>;
  thetas: readonly number[];
  phis: readonly number[];
}

function hemiKey(thetaDeg: number, phiDeg: number): string {
  const theta = pyRound(thetaDeg);
  const phi = ((pyRound(phiDeg) % 360) + 360) % 360;
  return `${theta},${phi}`;
}

// Gain and axial-ratio maps over the whole upper hemisphere for one tuned
// design: one nec2c run on the theta x phi grid. Mirrors plot.py's
// _hemisphere().
export async function skyData(
  result: DesignResult,
  runner: NecRunner,
): Promise<SkyData> {
  const spec = result.spec;
  const base = result.baseFactor;
  const { result: nec } = await analyze(spec, base, { grid: HEMI_GRID }, runner);
  const gainMap = new Map<string, number>();
  const arMap = new Map<string, number>();
  for (const point of nec.pattern) {
    const key = hemiKey(point.thetaDeg, point.phiDeg);
    gainMap.set(key, point.totalGainDb);
    arMap.set(key, Math.min(axialRatioDb(point.axialRatio), AR_MAP_MAX_DB));
  }
  return { gainMap, arMap, thetas: HEMI_THETAS, phis: HEMI_PHIS };
}
