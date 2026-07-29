// Geometry gatekeeping for a DesignSpec. Ported from the validation guards in
// src/awadateki/design.py (_eggbeater). The rest of design.py (tuning, harness
// synthesis, metrics, optimizer) is a later wave.

import { equivalentRadiusM } from "./conductor";
import {
  FEED_LINE,
  MAX_SEGMENTS,
  MIN_LOOP_OFFSET_DIAMETERS,
  isBalancedFeed,
} from "./constants";
import { formatG } from "./format";
import type { DesignSpec } from "./spec";

// Throw if the spec's geometry cannot be built into a valid NEC model. The
// checks and their order mirror the Python guards so error text is comparable.
export function validateSpec(spec: DesignSpec): void {
  if (spec.segments > MAX_SEGMENTS) {
    throw new Error(
      `segments ${spec.segments} exceeds ${MAX_SEGMENTS}; the loop wire tags would collide with the next NEC tag range`,
    );
  }
  if (spec.phasingCoax !== null && spec.feed !== FEED_LINE) {
    throw new Error(
      `phasing_coax applies only to the line feed; the ${JSON.stringify(spec.feed)} harness fixes its own cables`,
    );
  }
  if (spec.matchCoax !== null && isBalancedFeed(spec.feed)) {
    throw new Error(
      `match_coax does not apply to the ${JSON.stringify(spec.feed)} feed; it has no quarter-wave matching transformer`,
    );
  }
  const minOffsetMm =
    MIN_LOOP_OFFSET_DIAMETERS * 2.0e3 * equivalentRadiusM(spec.conductor);
  if (spec.loopOffsetMm < minOffsetMm) {
    throw new Error(
      `loop_offset_mm ${formatG(spec.loopOffsetMm)} is below ${minOffsetMm.toFixed(1)} (${formatG(MIN_LOOP_OFFSET_DIAMETERS)}x the equivalent conductor diameter); the loops would touch or overlap at the crossings`,
    );
  }
}
