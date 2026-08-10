// Crossed full-wave loop geometry for an eggbeater antenna.
// Ported from the retired Python geometry.py.
//
// The antenna is two full-wave loops in perpendicular vertical planes sharing a
// common vertical (Z) axis: loop A in the XZ plane, loop B in the YZ plane. Each
// loop is approximated as a regular polygon of straight NEC wires, with the feed
// segment placed at the bottom of the loop (closest to the reflector).

import { formatG } from "./format";

// Speed of light expressed so that wavelengthM = LIGHT_MHZ_M / freqMhz.
export const LIGHT_MHZ_M = 299.792458;
// NEC tag numbers: loop A occupies [LOOP_A_TAG_BASE, +segments), loop B likewise.
// The bases are spaced wide enough that the per-side tags never overlap.
export const LOOP_A_TAG_BASE = 100;
export const LOOP_B_TAG_BASE = 200;
// Reflector radials occupy [RADIAL_TAG_BASE, +count).
export const RADIAL_TAG_BASE = 300;
// Default polygon resolution; each side becomes one NEC segment.
export const DEFAULT_SEGMENTS = 36;

// Loop outline shapes. A squircle is a square with radiused corners: four
// straight sides joined by quarter-circle arcs of a given corner radius.
export const SHAPE_CIRCLE = "circle";
export const SHAPE_SQUARE = "square";
export const SHAPE_SQUIRCLE = "squircle";
export const LOOP_SHAPES = [SHAPE_CIRCLE, SHAPE_SQUARE, SHAPE_SQUIRCLE] as const;
export type LoopShape = (typeof LOOP_SHAPES)[number];
// Dense samples used to measure and resample a non-circular unit outline.
export const CURVE_SAMPLES = 2048;
// Points per quarter-circle corner arc when densifying a squircle outline.
export const CORNER_ARC_SAMPLES = 64;

export function wavelengthM(freqMhz: number): number {
  return LIGHT_MHZ_M / freqMhz;
}

// One straight NEC wire (GW card).
//   tag: NEC tag number.
//   segments: number of NEC segments along the wire.
//   x1, y1, z1: first endpoint, meters.
//   x2, y2, z2: second endpoint, meters.
//   radiusM: conductor radius, meters.
export interface Wire {
  tag: number;
  segments: number;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  radiusM: number;
}

// A single full-wave loop.
//   wires: ordered wires forming the closed polygon.
//   feedTag: tag of the wire carrying the feed segment.
//   feedSegment: 1-based segment number within feedTag.
export interface Loop {
  wires: Wire[];
  feedTag: number;
  feedSegment: number;
}

// The pair of crossed loops. wires is the concatenation loopA + loopB.
export interface Eggbeater {
  loopA: Loop;
  loopB: Loop;
  wires: Wire[];
}

type Point2 = [number, number];
type Point3 = [number, number, number];

// Circle radius for a loop of the given perimeter.
export function loopRadiusM(perimeterM: number): number {
  return perimeterM / (2.0 * Math.PI);
}

// Point on the unit square outline (spanning [-1, 1]) in direction theta.
function squareUnitPoint(theta: number): Point2 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const reach = Math.max(Math.abs(c), Math.abs(s));
  return [c / reach, s / reach];
}

let denseUnitSquareCache: Point2[] | null = null;

// Closed dense polyline of the unit square, starting at the bottom.
function denseUnitSquare(): Point2[] {
  if (denseUnitSquareCache === null) {
    const points: Point2[] = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      points.push(
        squareUnitPoint(-Math.PI / 2.0 + (2.0 * Math.PI * i) / CURVE_SAMPLES),
      );
    }
    denseUnitSquareCache = points;
  }
  return denseUnitSquareCache;
}

function cumulativeArc(points: Point2[]): number[] {
  const cum = [0.0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const last = cum[cum.length - 1];
    if (prev === undefined || cur === undefined || last === undefined) {
      continue;
    }
    cum.push(last + Math.hypot(cur[0] - prev[0], cur[1] - prev[1]));
  }
  return cum;
}

// Leftmost index i such that cum[i] >= target (Python bisect.bisect_left).
function bisectLeft(cum: number[], target: number): number {
  let low = 0;
  let high = cum.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const value = cum[mid];
    if (value !== undefined && value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

// Python modulo (result carries the sign of the divisor).
function pythonMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

// `segments` vertices at equal arc length, the first side straddling the start
// point of the dense outline (the bottom, so the feed sits there).
function resampleClosed(dense: Point2[], segments: number): Point2[] {
  const cum = cumulativeArc(dense);
  const total = cum[cum.length - 1] ?? 0.0;
  const points: Point2[] = [];
  for (let k = 0; k < segments; k++) {
    const target = pythonMod(((k - 0.5) / segments) * total, total);
    const i = bisectLeft(cum, target);
    if (i <= 0) {
      const first = dense[0];
      if (first !== undefined) {
        points.push([first[0], first[1]]);
      }
      continue;
    }
    const s0 = cum[i - 1] ?? 0.0;
    const s1 = cum[i] ?? 0.0;
    const frac = s1 === s0 ? 0.0 : (target - s0) / (s1 - s0);
    const p0 = dense[i - 1];
    const p1 = dense[i];
    if (p0 === undefined || p1 === undefined) {
      continue;
    }
    points.push([p0[0] + frac * (p1[0] - p0[0]), p0[1] + frac * (p1[1] - p0[1])]);
  }
  return points;
}

// Bounding side of a rounded-corner square of the given perimeter.
// Perimeter = 4 straight sides of (side - 2r) plus four quarter arcs (2*pi*r):
// P = 4*(S - 2r) + 2*pi*r, so S = (P + (8 - 2*pi)*r) / 4.
export function roundedSquareSide(perimeterM: number, cornerRadiusM: number): number {
  return (perimeterM + (8.0 - 2.0 * Math.PI) * cornerRadiusM) / 4.0;
}

// Dense (across, up) outline of a rounded square centered at the origin, starting
// at the bottom-center so the feed lands at the bottom.
function roundedSquareOutline(sideM: number, radiusM: number): Point2[] {
  const half = sideM / 2.0;
  const c = half - radiusM; // corner-arc center offset from the origin on each axis
  const points: Point2[] = [[0.0, -half]];
  // Four corners, counter-clockwise from bottom-right; each is a quarter arc
  // preceded by the straight run leading into it.
  const corners: Array<[number, number, number, Point2]> = [
    [c, -c, -Math.PI / 2.0, [c, -half]], // bottom-right
    [c, c, 0.0, [half, c]], // top-right
    [-c, c, Math.PI / 2.0, [-c, half]], // top-left
    [-c, -c, Math.PI, [-half, -c]], // bottom-left
  ];
  for (const [cx, cy, startAngle, runEnd] of corners) {
    points.push([runEnd[0], runEnd[1]]); // straight run up to the arc start
    for (let i = 1; i <= CORNER_ARC_SAMPLES; i++) {
      const angle = startAngle + ((Math.PI / 2.0) * i) / CORNER_ARC_SAMPLES;
      points.push([cx + radiusM * Math.cos(angle), cy + radiusM * Math.sin(angle)]);
    }
  }
  points.push([0.0, -half]); // close along the bottom-left straight run
  return points;
}

let squareUnitPerimeterCache: number | null = null;

function squareUnitPerimeter(): number {
  if (squareUnitPerimeterCache === null) {
    const cum = cumulativeArc(denseUnitSquare());
    squareUnitPerimeterCache = cum[cum.length - 1] ?? 0.0;
  }
  return squareUnitPerimeterCache;
}

// Across-dimension (bounding width) of a loop of the given perimeter: diameter
// for a circle, side for a square or squircle.
export function loopExtentM(
  perimeterM: number,
  shape: string,
  cornerRadiusM = 0.0,
): number {
  if (shape === SHAPE_SQUIRCLE) {
    return roundedSquareSide(perimeterM, cornerRadiusM);
  }
  const unit = shape === SHAPE_CIRCLE ? 2.0 * Math.PI : squareUnitPerimeter();
  return (2.0 * perimeterM) / unit;
}

// Loop outline vertices (across, up) in meters, feed side at the bottom.
function loopOutlinePoints(
  shape: string,
  perimeterM: number,
  cornerRadiusM: number,
  segments: number,
): Point2[] {
  if (shape === SHAPE_CIRCLE) {
    const radius = loopRadiusM(perimeterM);
    const step = (2.0 * Math.PI) / segments;
    const start = -Math.PI / 2.0 - step / 2.0;
    const points: Point2[] = [];
    for (let k = 0; k < segments; k++) {
      points.push([
        radius * Math.cos(start + k * step),
        radius * Math.sin(start + k * step),
      ]);
    }
    return points;
  }
  if (shape === SHAPE_SQUARE) {
    const scale = perimeterM / squareUnitPerimeter();
    return resampleClosed(denseUnitSquare(), segments).map(
      ([u, v]) => [u * scale, v * scale] as Point2,
    );
  }
  const side = roundedSquareSide(perimeterM, cornerRadiusM);
  return resampleClosed(roundedSquareOutline(side, cornerRadiusM), segments);
}

// Build one polygonal loop of the given outline in the "xz" or "yz" plane.
//
// Every side is one segment of equal length and the bottom side carries the
// feed, keeping tagBase; the rest take the following tags.
//
// The physical feed gap is deliberately not modeled. NEC's applied-field source
// already is a delta-gap feed, and carving a short fixed-length wire out of the
// bottom side to represent the gap leaves the source segment a fixed length
// while its neighbours shrink with the segment count -- which made the loop
// impedance drift by 92% over a 7x mesh refinement instead of converging. With a
// uniform mesh the same loop settles within 2% (see docs/segmentation.md). The
// gap remains a reported build dimension; at ~0.5% of the circumference its
// geometric effect is far below that error.
function makeLoop(
  plane: "xz" | "yz",
  perimeterM: number,
  cornerRadiusM: number,
  centerZM: number,
  conductorRadiusM: number,
  tagBase: number,
  segments: number,
  shape: string,
): Loop {
  const points: Point3[] = [];
  for (const [across, upOffset] of loopOutlinePoints(
    shape,
    perimeterM,
    cornerRadiusM,
    segments,
  )) {
    const up = centerZM + upOffset;
    points.push(plane === "xz" ? [across, 0.0, up] : [0.0, across, up]);
  }
  const first = points[0];
  if (first === undefined) {
    throw new Error("empty loop outline");
  }
  points.push([first[0], first[1], first[2]]);

  const a = points[0];
  const b = points[1];
  if (a === undefined || b === undefined) {
    throw new Error("degenerate loop outline");
  }
  // Each segment: [tag, startPoint, endPoint].
  const segs: Array<[number, Point3, Point3]> = [[tagBase, a, b]];
  let nextTag = tagBase + 1;
  for (let k = 1; k < segments; k++) {
    const p = points[k];
    const q = points[k + 1];
    if (p === undefined || q === undefined) {
      continue;
    }
    segs.push([nextTag, p, q]);
    nextTag += 1;
  }

  const wires: Wire[] = segs.map(([tag, p, q]) => ({
    tag,
    segments: 1,
    x1: p[0],
    y1: p[1],
    z1: p[2],
    x2: q[0],
    y2: q[1],
    z2: q[2],
    radiusM: conductorRadiusM,
  }));
  return { wires, feedTag: tagBase, feedSegment: 1 };
}

// Build crossed loops A (XZ plane) and B (YZ plane).
//
// cornerRadiusM is the radius of the rounded corners for the squircle shape; it
// is ignored for circle and square. It must be positive and smaller than the
// equivalent circle radius (perimeter / 2*pi), past which no straight side
// remains and the shape would be a circle.
//
// loopOffsetM vertically separates the two loop centers (loop A below, loop B
// above, each by half the offset) so the crossed conductors clear at the top
// and bottom crossings; the mean height stays at centerZM.
//
// The physical feed gap is not modeled; see makeLoop for why.
export function makeEggbeater(
  perimeterAM: number,
  perimeterBM: number,
  centerZM: number,
  conductorRadiusM: number,
  segments: number = DEFAULT_SEGMENTS,
  shape: string = SHAPE_CIRCLE,
  cornerRadiusM = 0.0,
  loopOffsetM = 0.0,
): Eggbeater {
  if (!(LOOP_SHAPES as readonly string[]).includes(shape)) {
    throw new Error(`unknown loop shape: ${JSON.stringify(shape)}`);
  }
  if (shape === SHAPE_SQUIRCLE) {
    const maxRadius = Math.min(perimeterAM, perimeterBM) / (2.0 * Math.PI);
    if (!(cornerRadiusM > 0.0 && cornerRadiusM < maxRadius)) {
      throw new Error(
        `squircle corner radius ${formatShort(cornerRadiusM)} m must be in ` +
          `(0, ${formatShort(maxRadius)}) for this loop perimeter`,
      );
    }
  }
  const halfOffset = loopOffsetM / 2.0;
  const loopA = makeLoop(
    "xz",
    perimeterAM,
    cornerRadiusM,
    centerZM - halfOffset,
    conductorRadiusM,
    LOOP_A_TAG_BASE,
    segments,
    shape,
  );
  const loopB = makeLoop(
    "yz",
    perimeterBM,
    cornerRadiusM,
    centerZM + halfOffset,
    conductorRadiusM,
    LOOP_B_TAG_BASE,
    segments,
    shape,
  );
  return { loopA, loopB, wires: [...loopA.wires, ...loopB.wires] };
}

// Build a reflector of evenly spaced radial wires from a common hub.
//
// Radials run from the hub on the Z axis outward in azimuth; a positive droop
// angle tilts them downward from horizontal. They share the hub coordinate, so
// NEC connects them there.
export function makeRadials(
  count: number,
  lengthM: number,
  hubZM: number,
  droopDeg: number,
  conductorRadiusM: number,
  segmentsPerRadial: number,
): Wire[] {
  const droop = (droopDeg * Math.PI) / 180.0;
  const horizontal = lengthM * Math.cos(droop);
  const drop = lengthM * Math.sin(droop);
  const wires: Wire[] = [];
  for (let i = 0; i < count; i++) {
    const azimuth = (2.0 * Math.PI * i) / count;
    wires.push({
      tag: RADIAL_TAG_BASE + i,
      segments: segmentsPerRadial,
      x1: 0.0,
      y1: 0.0,
      z1: hubZM,
      x2: horizontal * Math.cos(azimuth),
      y2: horizontal * Math.sin(azimuth),
      z2: hubZM - drop,
      radiusM: conductorRadiusM,
    });
  }
  return wires;
}

// Python "%.4g" used in the squircle validation message.
function formatShort(x: number): string {
  return formatG(x, 4);
}
