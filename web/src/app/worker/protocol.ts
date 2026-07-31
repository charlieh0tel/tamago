// Message protocol between the UI and the engine Web Worker.
//
// Every job carries a unique id. The worker replies with progress events (for
// optimize) and exactly one terminal message: result, error, or cancelled.

import type { DesignResult, DesignSpec } from "../../engine/index";
import type { ChartData, SkyData } from "../engineExtras";

// Provenance-writable field values produced by an Optimize run.
export interface OptimizedFields {
  perimeterMm: number;
  reflectorSpacingWl: number;
  radialDroopDeg: number;
  radialCount: number;
}

// A rendered analysis: the tuned DesignResult plus the pre-rendered cut sheet
// and the serialized result dict (for the Files tab / result.json download).
export interface AnalysisBundle {
  result: DesignResult;
  cutSheet: string;
  resultJson: string;
}

export interface OptimizeBundle extends AnalysisBundle {
  spec: DesignSpec;
  fields: OptimizedFields;
}

// Optimizer progress: a coarse stage, a running nec2c-run count, and elapsed
// time. Per-candidate cost is not surfaced (the engine optimizer exposes no
// callback and must not be modified); the stage transitions between the tuning
// and reflector-search phases the worker drives explicitly.
export interface OptimizeProgress {
  stage: string;
  runs: number;
  // Expected total runs for this job, from the search's known shape (see
  // estimatedOptimizeRuns). An estimate, not a bound: it is what gives the
  // progress bar a denominator, and `runs` may overrun it slightly.
  totalRuns: number;
  elapsedS: number;
}

export type WorkerRequest =
  | { id: number; kind: "analyze"; spec: DesignSpec; perimeterMm: number | null }
  | { id: number; kind: "optimize"; spec: DesignSpec }
  | { id: number; kind: "chartData"; result: DesignResult }
  | { id: number; kind: "skyData"; result: DesignResult }
  | { id: number; kind: "cancel"; target: number };

export type WorkerResponse =
  | { id: number; type: "analyze"; bundle: AnalysisBundle }
  | { id: number; type: "optimize"; bundle: OptimizeBundle }
  | { id: number; type: "chartData"; data: ChartData }
  | { id: number; type: "skyData"; data: SkyData }
  | { id: number; type: "progress"; progress: OptimizeProgress }
  | { id: number; type: "error"; message: string }
  | { id: number; type: "cancelled" };
