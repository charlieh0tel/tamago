// Helpers bridging the DesignSpec model and the UI's provenance-aware state.

import {
  type Conductor,
  type ConductorKind,
  type DesignSpec,
  KIND_ROUND,
  KIND_STRIP,
  REFLECTOR_NONE,
  barConductor,
  makeDesignSpec,
  roundConductor,
  stripConductor,
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
