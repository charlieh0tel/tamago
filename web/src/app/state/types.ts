// UI state shape and action union for the designer reducer.

import type { DesignSpec } from "../../engine/index";
import type { ChartData, SkyData } from "../engineExtras";
import type { AnalysisBundle, OptimizeProgress } from "../worker/protocol";

// Provenance of each solver-writable field (docs/web-ux.md):
//   user -- typed by the user; est -- live closed-form formula; opt -- an
//   Optimize snapshot.
// "default": the spec default, untouched by any actor (renders no tag).
export type Provenance = "user" | "est" | "opt" | "default";

// The four solver-writable fields carry provenance tags.
export interface ProvenanceMap {
  perim: Provenance;
  spacing: Provenance;
  droop: Provenance;
  count: Provenance;
}

export type ProvField = keyof ProvenanceMap;

// Tuning/analysis status shown in the header chip.
export type TuneStatus =
  | "fresh" // nothing analyzed yet and nothing edited
  | "edited" // spec changed since last Analyze
  | "analyzing"
  | "analyzed" // analyzed but not tuned (perimeter not a fresh opt value)
  | "tuned" // analyzed with a fresh opt perimeter -> quadrature
  | "optimizing";

// Freshness of a lazily-computed results tier (charts, sky maps).
export type TierState = "idle" | "stale" | "loading" | "ready" | "error";

export type TabId = "cut" | "sch" | "charts" | "sky" | "3d" | "files";

export interface TierSlot<T> {
  state: TierState;
  data: T | null;
}

export interface UiState {
  spec: DesignSpec;
  // The literal loop perimeter shown in the field, in millimetres. Mirrors
  // spec.loopPerimeterMm but is always populated for display; provenance says
  // how it was set.
  perimeterMm: number;
  prov: ProvenanceMap;
  // Single global staleness flag: any edit after an Optimize run marks all opt
  // tags as stale (opt*), per docs/web-ux.md.
  optStale: boolean;
  status: TuneStatus;
  analysis: AnalysisBundle | null;
  // Analysis fingerprint of the spec that produced `analysis` (see
  // analysisFingerprint). Results are stale when it differs from the current
  // spec's fingerprint. Null when nothing has been analyzed.
  analyzedFingerprint: string | null;
  charts: TierSlot<ChartData>;
  sky: TierSlot<SkyData>;
  activeTab: TabId;
  view: "designer" | "report";
  optProgress: OptimizeProgress | null;
  // Field ids to flash after an Optimize writeback (cleared by CLEAR_FLASH).
  flashFields: string[];
  toast: string | null;
  jsonOpen: boolean;
  error: string | null;
}

export type Action =
  | { type: "SET_FREQ"; value: number }
  | { type: "SET_LABEL"; value: string }
  | { type: "SET_CONDUCTOR"; spec: DesignSpec }
  | { type: "SET_PERIMETER"; value: number }
  | { type: "ESTIMATE_PERIMETER" }
  | { type: "PATCH_SPEC"; patch: Partial<DesignSpec> }
  | { type: "SET_REFLECTOR_FIELD"; field: "spacing" | "droop" | "count"; value: number }
  | { type: "LOAD_SPEC"; spec: DesignSpec }
  | { type: "ANALYZE_START" }
  | { type: "ANALYZE_DONE"; bundle: AnalysisBundle }
  | { type: "ANALYZE_ERROR"; message: string }
  | { type: "OPTIMIZE_START" }
  | { type: "OPTIMIZE_PROGRESS"; progress: OptimizeProgress }
  | {
      type: "OPTIMIZE_DONE";
      bundle: AnalysisBundle;
      spec: DesignSpec;
      perimeterMm: number;
    }
  | { type: "OPTIMIZE_CANCELLED" }
  | { type: "OPTIMIZE_ERROR"; message: string }
  | { type: "CHARTS_START" }
  | { type: "CHARTS_DONE"; data: ChartData }
  | { type: "CHARTS_ERROR" }
  | { type: "SKY_START" }
  | { type: "SKY_DONE"; data: SkyData }
  | { type: "SKY_ERROR" }
  | { type: "SET_TAB"; tab: TabId }
  | { type: "SET_VIEW"; view: "designer" | "report" }
  | { type: "OPEN_JSON" }
  | { type: "CLOSE_JSON" }
  | { type: "TOAST"; message: string | null }
  | { type: "CLEAR_FLASH" };
