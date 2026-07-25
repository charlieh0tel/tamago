// Conductor cross-section models and conversion to a NEC equivalent radius.
// Port of src/awadateki/conductor.py.
//
// NEC-2 models every wire as a round conductor specified by its radius. Real
// hardware is built from round wire or rectangular bar stock, so each
// cross-section is reduced to the radius of a cylinder presenting the same
// external inductance per unit length (matched via the self geometric-mean
// distance, GMD).

import { formatG } from "./format";

// A round wire of radius r has self-GMD = CIRCLE_GMD_FACTOR * r.
export const CIRCLE_GMD_FACTOR = Math.exp(-0.25);
// Self-GMD of a rectangular cross-section, approximated as
// RECT_GMD_FACTOR * (width + thickness) for comparable width and thickness.
export const RECT_GMD_FACTOR = 0.2235;
// Equivalent radius of a thin flat strip is STRIP_EQUIV_RADIUS_FACTOR * width
// (exact result from conformal mapping of a zero-thickness strip).
export const STRIP_EQUIV_RADIUS_FACTOR = 0.25;
export const MM_PER_M = 1000.0;

export const KIND_ROUND = "round";
export const KIND_STRIP = "strip";
export const KIND_BAR = "bar";

export type ConductorKind = typeof KIND_ROUND | typeof KIND_STRIP | typeof KIND_BAR;

// A conductor reduced to its NEC equivalent radius.
//   kind: KIND_ROUND, KIND_STRIP, or KIND_BAR.
//   dimensionsMm: shape dimensions in millimetres -- round: [diameter];
//     strip: [width]; bar: [width, thickness]. Retained so the conductor can be
//     serialized back to its construction parameters.
//   description: human-readable stock description for decks and cut sheets.
//   equivalentRadiusMm: radius of the equivalent round wire, millimetres.
export interface Conductor {
  kind: ConductorKind;
  dimensionsMm: number[];
  description: string;
  equivalentRadiusMm: number;
}

export function equivalentRadiusM(conductor: Conductor): number {
  return conductor.equivalentRadiusMm / MM_PER_M;
}

// Round wire or tube of the given outside diameter.
export function roundConductor(diameterMm: number): Conductor {
  return {
    kind: KIND_ROUND,
    dimensionsMm: [diameterMm],
    description: `round, ${formatG(diameterMm)} mm dia`,
    equivalentRadiusMm: diameterMm / 2.0,
  };
}

// Thin flat strip (thickness negligible) of the given width.
export function stripConductor(widthMm: number): Conductor {
  return {
    kind: KIND_STRIP,
    dimensionsMm: [widthMm],
    description: `flat strip, ${formatG(widthMm)} mm wide`,
    equivalentRadiusMm: STRIP_EQUIV_RADIUS_FACTOR * widthMm,
  };
}

// Rectangular bar stock of the given width and thickness.
// A non-positive thickness degenerates to a flat strip.
export function barConductor(widthMm: number, thicknessMm: number): Conductor {
  if (thicknessMm <= 0.0) {
    return stripConductor(widthMm);
  }
  const gmd = RECT_GMD_FACTOR * (widthMm + thicknessMm);
  return {
    kind: KIND_BAR,
    dimensionsMm: [widthMm, thicknessMm],
    description: `bar, ${formatG(widthMm)} x ${formatG(thicknessMm)} mm`,
    equivalentRadiusMm: gmd / CIRCLE_GMD_FACTOR,
  };
}
