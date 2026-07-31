// Helpers bridging the DesignSpec model and the UI's provenance-aware state.

import {
  type Conductor,
  type ConductorKind,
  type DesignSpec,
  KIND_ROUND,
  KIND_STRIP,
  MM_PER_M,
  REFLECTOR_NONE,
  SHAPE_SQUIRCLE,
  barConductor,
  loopExtentM,
  makeDesignSpec,
  roundConductor,
  stripConductor,
  wavelengthM,
} from "../../engine/index";
import { estimatePerimeterMm } from "../engineExtras";
import type { ProvenanceMap, UiState } from "./types";

// A reasonable starting design: a free-space 2 m line-fed eggbeater. The
// perimeter starts on the live estimate; the reflector is off so the first
// Analyze / Optimize is quick.
export function defaultSpec(): DesignSpec {
  return makeDesignSpec(145.9, roundConductor(5.0), {
    label: "2 m",
    reflector: REFLECTOR_NONE,
  });
}

// Rebuild a conductor when the user changes kind or a dimension.
export function buildConductor(kind: ConductorKind, dims: number[]): Conductor {
  if (kind === KIND_ROUND) {
    return roundConductor(dims[0] ?? 1.0);
  }
  if (kind === KIND_STRIP) {
    return stripConductor(dims[0] ?? 1.0);
  }
  return barConductor(dims[0] ?? 1.0, dims[1] ?? 1.0);
}

// Provenance implied by a loaded spec (from JSON, the hash, or localStorage):
// an optimization block means every writable field is an opt snapshot; a
// literal loop_perimeter_mm without it means the user set it; otherwise the
// perimeter is the live estimate.
export function provenanceForSpec(spec: DesignSpec): ProvenanceMap {
  if (spec.optimization !== null) {
    return { perim: "opt", spacing: "opt", droop: "opt", count: "opt" };
  }
  const perim = spec.loopPerimeterMm !== null ? "user" : "est";
  return { perim, spacing: "default", droop: "default", count: "default" };
}

// The perimeter (mm) to display for a spec and its provenance.
export function perimeterForSpec(spec: DesignSpec, prov: ProvenanceMap): number {
  if (prov.perim === "est" || spec.loopPerimeterMm === null) {
    return estimatePerimeterMm(spec.freqMhz);
  }
  return spec.loopPerimeterMm;
}

// Whether the perimeter provenance is a *fresh* opt value (tuned to quadrature).
export function isTuned(state: Pick<UiState, "prov" | "optStale">): boolean {
  return state.prov.perim === "opt" && !state.optStale;
}

// Reflector spacing is stored as the loop-center height, because that is where
// the geometry places the loops, but the height a builder can measure is the
// clearance under the lower loop -- the center is a point in mid air. The two
// differ by how far the bottom conductor hangs below the pair center: half the
// loop offset (loop A rides below) plus half the loop's bounding extent (every
// shape is symmetric).
//
// That drop depends on the perimeter, so these take the perimeter the rail is
// displaying. The consequence is worth knowing: retuning the perimeter leaves
// the stored center height alone but changes the clearance it corresponds to.
function loopBottomDropWl(spec: DesignSpec, perimeterMm: number): number {
  const wavelength = wavelengthM(spec.freqMhz);
  const cornerRadiusM =
    spec.loopShape === SHAPE_SQUIRCLE ? spec.cornerRadiusWl * wavelength : 0.0;
  const extentM = loopExtentM(perimeterMm / MM_PER_M, spec.loopShape, cornerRadiusM);
  return (spec.loopOffsetMm / MM_PER_M / 2.0 + extentM / 2.0) / wavelength;
}

// Reflector-to-lower-loop clearance, in wavelengths, for the displayed spacing.
export function clearanceWlForSpec(spec: DesignSpec, perimeterMm: number): number {
  return spec.reflectorSpacingWl - loopBottomDropWl(spec, perimeterMm);
}

// The loop-center height (what the spec stores) giving this clearance.
export function spacingWlForClearance(
  spec: DesignSpec,
  perimeterMm: number,
  clearanceWl: number,
): number {
  return clearanceWl + loopBottomDropWl(spec, perimeterMm);
}

// The same clearance as an absolute length, and back. The rail offers both so a
// builder can work in whichever one they have: wavelengths for a design scaled
// across bands, millimeters for a tape measure.
export function clearanceMmForSpec(spec: DesignSpec, perimeterMm: number): number {
  return clearanceWlForSpec(spec, perimeterMm) * wavelengthM(spec.freqMhz) * MM_PER_M;
}

export function spacingWlForClearanceMm(
  spec: DesignSpec,
  perimeterMm: number,
  clearanceMm: number,
): number {
  const clearanceWl = clearanceMm / MM_PER_M / wavelengthM(spec.freqMhz);
  return spacingWlForClearance(spec, perimeterMm, clearanceWl);
}
