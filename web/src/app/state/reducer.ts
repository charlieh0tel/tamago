// Designer reducer: the single source of truth for the spec, provenance, and
// results freshness. There is no hidden derived state -- every solver output is
// written back into ordinary fields (docs/web-ux.md).

import type { DesignSpec } from "../../engine/index";
import { estimatePerimeterMm } from "../engineExtras";
import { analysisFingerprint } from "../hash";
import type { Action, TierSlot, UiState } from "./types";
import { defaultSpec, isTuned, perimeterForSpec, provenanceForSpec } from "./uiSpec";

// Results are stale when the current spec would no longer produce the analysis
// on screen (label/notes edits are ignored -- see analysisFingerprint).
export function resultsStale(
  state: Pick<UiState, "analysis" | "analyzedFingerprint" | "spec">,
): boolean {
  return (
    state.analysis !== null &&
    state.analyzedFingerprint !== null &&
    analysisFingerprint(state.spec) !== state.analyzedFingerprint
  );
}

export function initialState(spec: DesignSpec = defaultSpec()): UiState {
  const prov = provenanceForSpec(spec);
  return {
    spec,
    perimeterMm: perimeterForSpec(spec, prov),
    prov,
    optStale: false,
    status: "fresh",
    analysis: null,
    analyzedFingerprint: null,
    charts: { state: "idle", data: null },
    sky: { state: "idle", data: null },
    activeTab: "cut",
    view: "designer",
    optProgress: null,
    flashFields: [],
    toast: null,
    jsonOpen: false,
    error: null,
  };
}

// Mark a results tier stale when it holds data, idle otherwise.
function stale<T>(slot: TierSlot<T>): TierSlot<T> {
  return slot.data !== null
    ? { state: "stale", data: slot.data }
    : { state: "idle", data: null };
}

// Apply the common consequences of any spec edit: bump global staleness, set
// the chip to "edited", and stale the lazy tiers.
function edited(state: UiState, patch: Partial<UiState>): UiState {
  return {
    ...state,
    optStale: true,
    status: "edited",
    error: null,
    charts: stale(state.charts),
    sky: stale(state.sky),
    ...patch,
  };
}

// Status implied by the current provenance/analysis after a run settles.
function settledStatus(
  state: Pick<UiState, "prov" | "optStale" | "analysis">,
): UiState["status"] {
  if (state.analysis === null) {
    return "edited";
  }
  return isTuned(state) ? "tuned" : "analyzed";
}

export function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case "SET_FREQ": {
      // Any analysis-affecting edit invalidates the optimization record, so it
      // is never serialized as if it still described the design (a shared or
      // reopened edited design must not look freshly optimized).
      const spec = { ...state.spec, freqMhz: action.value, optimization: null };
      const perimeterMm =
        state.prov.perim === "est"
          ? estimatePerimeterMm(action.value)
          : state.perimeterMm;
      const flashFields = state.prov.perim === "est" ? ["perim"] : state.flashFields;
      return edited(state, { spec, perimeterMm, flashFields });
    }
    case "SET_LABEL":
      return edited(state, { spec: { ...state.spec, label: action.value || null } });
    case "SET_CONDUCTOR":
      return edited(state, { spec: { ...action.spec, optimization: null } });
    case "SET_PERIMETER": {
      const spec = { ...state.spec, loopPerimeterMm: action.value, optimization: null };
      return edited(state, {
        spec,
        perimeterMm: action.value,
        prov: { ...state.prov, perim: "user" },
      });
    }
    case "ESTIMATE_PERIMETER": {
      const value = estimatePerimeterMm(state.spec.freqMhz);
      const spec = { ...state.spec, loopPerimeterMm: null, optimization: null };
      return edited(state, {
        spec,
        perimeterMm: value,
        prov: { ...state.prov, perim: "est" },
        flashFields: ["perim"],
        toast: `estimate: 1.05 x wavelength = ${value.toFixed(1)} mm (tracks frequency)`,
      });
    }
    case "PATCH_SPEC":
      return edited(state, {
        spec: { ...state.spec, ...action.patch, optimization: null },
      });
    case "SET_REFLECTOR_FIELD": {
      const key =
        action.field === "spacing"
          ? "reflectorSpacingWl"
          : action.field === "droop"
            ? "radialDroopDeg"
            : "radialCount";
      const spec = {
        ...state.spec,
        [key]: action.value,
        optimization: null,
      } as DesignSpec;
      return edited(state, {
        spec,
        prov: { ...state.prov, [action.field]: "user" },
      });
    }
    case "LOAD_SPEC": {
      const next = initialState(action.spec);
      return { ...next, activeTab: state.activeTab, view: state.view };
    }
    case "ANALYZE_START":
      return { ...state, status: "analyzing", error: null };
    case "ANALYZE_DONE": {
      const analysis = action.bundle;
      // If the spec was edited during the run, the result no longer matches the
      // form: keep it (behind the stale banner) but report the design as edited.
      const edited = analysisFingerprint(state.spec) !== action.fingerprint;
      return {
        ...state,
        analysis,
        analyzedFingerprint: action.fingerprint,
        status: edited ? "edited" : settledStatus({ ...state, analysis }),
        charts: stale(state.charts),
        sky: stale(state.sky),
        error: null,
      };
    }
    case "ANALYZE_ERROR":
      return {
        ...state,
        status: "edited",
        error: action.message,
        toast: action.message,
      };
    case "OPTIMIZE_START":
      return { ...state, status: "optimizing", optProgress: null, error: null };
    case "OPTIMIZE_PROGRESS":
      return { ...state, optProgress: action.progress };
    case "OPTIMIZE_DONE": {
      const spec = { ...action.spec, loopPerimeterMm: action.perimeterMm };
      const prov = {
        perim: "opt",
        spacing: "opt",
        droop: "opt",
        count: "opt",
      } as const;
      return {
        ...state,
        spec,
        perimeterMm: action.perimeterMm,
        prov,
        optStale: false,
        analysis: action.bundle,
        analyzedFingerprint: analysisFingerprint(spec),
        status: "tuned",
        optProgress: null,
        flashFields: ["perim", "spacing", "droop", "count"],
        charts: stale(state.charts),
        sky: stale(state.sky),
        toast: "optimized -- perimeter and reflector written to the form",
        error: null,
      };
    }
    case "OPTIMIZE_CANCELLED": {
      // An edit during the run already set status "edited" and cancelled the
      // job; otherwise it was a manual cancel and the form is unchanged.
      const editCancel = state.status === "edited";
      return {
        ...state,
        status: editCancel ? "edited" : settledStatus(state),
        optProgress: null,
        toast: editCancel
          ? "optimization cancelled -- the design changed"
          : "optimization cancelled -- form unchanged",
      };
    }
    case "OPTIMIZE_ERROR":
      return {
        ...state,
        status: settledStatus(state),
        optProgress: null,
        error: action.message,
        toast: action.message,
      };
    case "CHARTS_START":
      return { ...state, charts: { state: "loading", data: state.charts.data } };
    case "CHARTS_DONE":
      return { ...state, charts: { state: "ready", data: action.data } };
    case "CHARTS_ERROR":
      return { ...state, charts: { state: "error", data: state.charts.data } };
    case "SKY_START":
      return { ...state, sky: { state: "loading", data: state.sky.data } };
    case "SKY_DONE":
      return { ...state, sky: { state: "ready", data: action.data } };
    case "SKY_ERROR":
      return { ...state, sky: { state: "error", data: state.sky.data } };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "OPEN_JSON":
      return { ...state, jsonOpen: true };
    case "CLOSE_JSON":
      return { ...state, jsonOpen: false };
    case "TOAST":
      return { ...state, toast: action.message };
    case "CLEAR_FLASH":
      return { ...state, flashFields: [] };
    default:
      return state;
  }
}
