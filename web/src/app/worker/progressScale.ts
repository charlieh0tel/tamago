// Turning the optimizer's nec2c run count into a progress fraction.
//
// The engine optimizer exposes no callback and must not be modified, so the
// worker's runner wrapper can only count nec2c invocations. A fraction needs a
// denominator, and the search's shape supplies one: for each radial count,
// PLACEMENT_SWEEPS coordinate-descent passes each run one golden-section
// minimization per free axis, and every placement evaluation costs one perimeter
// solve.

import {
  DROOP_BOUNDS_DEG,
  DROOP_TOLERANCE_DEG,
  GOLDEN_RATIO,
  PLACEMENT_SWEEPS,
  RADIAL_COUNT_GRID,
  REFLECTOR_NONE,
  REFLECTOR_RADIALS,
  SPACING_BOUNDS_WL,
  SPACING_TOLERANCE_WL,
} from "../../engine/constants";
import type { DesignSpec } from "../../engine/spec";
import type { OptimizeProgress } from "./protocol";

// Measured at 5.3 to 6.0 nec2c runs per placement evaluation across bands and
// reflector kinds: a radial search is 176 evaluations and ran 1026-1058 runs, a
// ground search is 22 and ran 117. Rounded up to 6, so the estimate runs a
// little high and the bar under-reports: finishing at 85% reads better than
// sitting at the far end with most of the search still to go, which is what a
// flat per-run scale did.
const RUNS_PER_PLACEMENT_EVAL = 6;

// Progress-bar fill is capped short of full, because the estimate is not a
// bound: a search that overruns it should sit just below the end rather than
// claim to have finished.
const BAR_MAX_PERCENT = 97;

// Golden-section evaluations to shrink a bracket inside a tolerance: two to
// bracket, then one per iteration.
function goldenEvals(range: number, tolerance: number): number {
  const iterations = Math.ceil(Math.log(tolerance / range) / Math.log(GOLDEN_RATIO));
  return 2 + Math.max(0, iterations);
}

// Expected nec2c runs for an Optimize of this spec. An estimate, not a bound:
// the perimeter solver's iteration count varies with the geometry.
export function estimatedOptimizeRuns(spec: DesignSpec): number {
  if (spec.reflector === REFLECTOR_NONE) {
    return RUNS_PER_PLACEMENT_EVAL; // perimeter tune only, no placement search
  }
  const radials = spec.reflector === REFLECTOR_RADIALS;
  const perSweep =
    goldenEvals(SPACING_BOUNDS_WL[1] - SPACING_BOUNDS_WL[0], SPACING_TOLERANCE_WL) +
    (radials
      ? goldenEvals(DROOP_BOUNDS_DEG[1] - DROOP_BOUNDS_DEG[0], DROOP_TOLERANCE_DEG)
      : 0);
  const counts = radials ? RADIAL_COUNT_GRID.length : 1;
  // The +1 is the final full design() the search runs on the winning placement.
  return (counts * PLACEMENT_SWEEPS * perSweep + 1) * RUNS_PER_PLACEMENT_EVAL;
}

// Progress-bar fill for the panel, as a percentage.
export function optFraction(progress: OptimizeProgress | null): number {
  if (progress === null || progress.totalRuns <= 0) {
    return 0;
  }
  return Math.min(BAR_MAX_PERCENT, (100 * progress.runs) / progress.totalRuns);
}
