// App shell: header + two panes (spec rail / results tabs) with a print/report
// view, per docs/web-ux.md. Owns the reducer, the engine service, URL-fragment
// sharing + localStorage restore, and the lazy compute of the charts/sky tiers.

import { useEffect, useReducer, useRef, useState } from "react";
import type { DesignResult } from "../engine/index";
import { Header } from "./components/Header";
import { JsonModal } from "./components/JsonModal";
import { Report } from "./components/Report";
import { Results } from "./components/Results";
import { SpecRail } from "./components/SpecRail";
import { Toast } from "./components/Toast";
import {
  analysisFingerprint,
  loadLastSpec,
  parseHash,
  saveLastSpec,
  shareLink,
  writeSpecHash,
} from "./hash";
import { initialState, reducer } from "./state/reducer";
import type { UiState } from "./state/types";
import {
  CancelledError,
  type EngineService,
  type Job,
  WorkerEngine,
} from "./worker/client";
import type { OptimizeBundle } from "./worker/protocol";

// Build the first UI state from the URL hash, then localStorage, then defaults.
function bootState(): { state: UiState; report: boolean; badLink: boolean } {
  const hash = parseHash(window.location.hash);
  if (hash.spec !== null) {
    return { state: initialState(hash.spec), report: hash.report, badLink: false };
  }
  if (hash.specError) {
    // A malformed shared link: start from the default rather than localStorage,
    // so the recipient never sees their own saved design under someone's link.
    return { state: initialState(), report: hash.report, badLink: true };
  }
  const last = loadLastSpec();
  if (last !== null) {
    return { state: initialState(last), report: hash.report, badLink: false };
  }
  return { state: initialState(), report: hash.report, badLink: false };
}

export function App({ engine }: { engine?: EngineService } = {}): JSX.Element {
  const boot = useRef<{ state: UiState; report: boolean; badLink: boolean }>();
  if (boot.current === undefined) {
    boot.current = bootState();
  }
  const [state, dispatch] = useReducer(
    reducer,
    boot.current.state,
    (s): UiState => ({ ...s, view: boot.current?.report ? "report" : "designer" }),
  );

  const engineRef = useRef<EngineService>();
  if (engineRef.current === undefined) {
    engineRef.current = engine ?? new WorkerEngine();
  }
  const svc = engineRef.current;
  const jobRef = useRef<Job<OptimizeBundle> | null>(null);
  const [badLink, setBadLink] = useState(boot.current.badLink);

  const toast = (message: string): void => dispatch({ type: "TOAST", message });

  const runAnalyze = async (): Promise<void> => {
    dispatch({ type: "ANALYZE_START" });
    try {
      const perimeter = state.prov.perim === "est" ? null : state.perimeterMm;
      // Fingerprint the spec actually analyzed; if the user edits during the
      // run, this no longer matches the form and the stale banner shows.
      const fingerprint = analysisFingerprint(state.spec);
      const bundle = await svc.analyze(state.spec, perimeter);
      dispatch({ type: "ANALYZE_DONE", bundle, fingerprint });
    } catch (err) {
      dispatch({
        type: "ANALYZE_ERROR",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const runOptimize = (): void => {
    dispatch({ type: "OPTIMIZE_START" });
    const job = svc.optimize(state.spec, (p) =>
      dispatch({ type: "OPTIMIZE_PROGRESS", progress: p }),
    );
    jobRef.current = job;
    job.promise
      .then((bundle) => {
        dispatch({
          type: "OPTIMIZE_DONE",
          bundle,
          spec: bundle.spec,
          perimeterMm: bundle.fields.perimeterMm,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof CancelledError) {
          dispatch({ type: "OPTIMIZE_CANCELLED" });
        } else {
          dispatch({
            type: "OPTIMIZE_ERROR",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        jobRef.current = null;
      });
  };

  const cancelOptimize = (): void => jobRef.current?.cancel();

  // Cancel a running Optimize the moment the design is edited, so its writeback
  // cannot clobber the edit. jobRef is set only while Optimize runs, and an edit
  // is the only thing that flips the status to "edited" during a run.
  useEffect(() => {
    if (state.status === "edited" && jobRef.current !== null) {
      jobRef.current.cancel();
    }
  }, [state.status]);

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shareLink(state.spec));
      toast("design link copied");
    } catch {
      toast("copy failed — the link is in the URL bar");
    }
  };

  // Persist to the URL hash + localStorage whenever the spec (or report view)
  // changes.
  useEffect(() => {
    writeSpecHash(state.spec, state.view === "report");
    saveLastSpec(state.spec);
  }, [state.spec, state.view]);

  // Clear field-flash highlights shortly after an Optimize writeback.
  useEffect(() => {
    if (state.flashFields.length === 0) {
      return;
    }
    const handle = setTimeout(() => dispatch({ type: "CLEAR_FLASH" }), 1400);
    return () => clearTimeout(handle);
  }, [state.flashFields]);

  // Lazily compute the charts tier when its tab (or the report) is shown and it
  // is idle or stale.
  const result: DesignResult | null = state.analysis?.result ?? null;
  const chartsWanted = state.activeTab === "charts" || state.view === "report";
  const chartsState = state.charts.state;
  useEffect(() => {
    if (result === null || !chartsWanted) {
      return;
    }
    if (chartsState !== "idle" && chartsState !== "stale") {
      return;
    }
    dispatch({ type: "CHARTS_START" });
    svc
      .chartData(result)
      .then((data) => dispatch({ type: "CHARTS_DONE", data }))
      .catch(() => dispatch({ type: "CHARTS_ERROR" }));
  }, [result, chartsWanted, chartsState, svc]);

  const skyWanted = state.activeTab === "sky" || state.view === "report";
  const skyState = state.sky.state;
  useEffect(() => {
    if (result === null || !skyWanted) {
      return;
    }
    if (skyState !== "idle" && skyState !== "stale") {
      return;
    }
    dispatch({ type: "SKY_START" });
    svc
      .skyData(result)
      .then((data) => dispatch({ type: "SKY_DONE", data }))
      .catch(() => dispatch({ type: "SKY_ERROR" }));
  }, [result, skyWanted, skyState, svc]);

  return (
    <div className="app">
      <Header onCopyLink={() => void copyLink()} />
      {badLink && (
        <div className="link-banner" role="alert">
          <span>That design link couldn't be read — showing the default design.</span>
          <button type="button" onClick={() => setBadLink(false)}>
            dismiss
          </button>
        </div>
      )}
      {state.view === "report" ? (
        <Report
          state={state}
          onBack={() => dispatch({ type: "SET_VIEW", view: "designer" })}
        />
      ) : (
        <div className="panes">
          <SpecRail
            state={state}
            dispatch={dispatch}
            onAnalyze={() => void runAnalyze()}
            onOptimize={runOptimize}
            onCancelOptimize={cancelOptimize}
          />
          <Results
            state={state}
            dispatch={dispatch}
            onAnalyze={() => void runAnalyze()}
            onPrintView={() => dispatch({ type: "SET_VIEW", view: "report" })}
            onToast={toast}
          />
        </div>
      )}
      {state.jsonOpen && (
        <JsonModal
          spec={state.spec}
          onApply={(spec) => {
            dispatch({ type: "LOAD_SPEC", spec });
            dispatch({ type: "CLOSE_JSON" });
            toast("spec applied from JSON");
          }}
          onClose={() => dispatch({ type: "CLOSE_JSON" })}
        />
      )}
      <Toast
        message={state.toast}
        onDismiss={() => dispatch({ type: "TOAST", message: null })}
      />
    </div>
  );
}
