// Engine Web Worker: owns the wasm nec2c runner and runs the long jobs off the
// main thread. Exposes analyze / optimize / chartData / skyData via postMessage
// with job ids, optimizer progress events, and cooperative cancellation.
//
// Cancellation and progress are implemented by *wrapping* the runner (the
// engine is not modified): the wrapper counts nec2c invocations, emits progress
// between them, and throws a CancelledError when the job's cancel flag is set,
// which unwinds whatever engine solver is in flight.

// The wasm runner (web/wasm/runner.mjs); typed via the ambient *.runner.mjs
// declaration in the test tree.
import { runNec } from "../../../wasm/runner.mjs";
import {
  type DesignResult,
  type DesignSpec,
  type NecRunner,
  REFLECTOR_NONE,
  design,
  formatCutSheet,
  optimizeReflector,
  resultsToJson,
  wavelengthM,
} from "../../engine/index";
import {
  analyzeLiteral,
  chartData,
  estimatePerimeterMm,
  factorForPerimeter,
  skyData,
} from "../engineExtras";
import type { OptimizedFields, WorkerRequest, WorkerResponse } from "./protocol";

const baseRunner: NecRunner = runNec;

// Minimal typed view of the dedicated-worker global scope (the WebWorker lib is
// not in tsconfig, and DOM's Window.postMessage has a different signature).
interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
}
const scope = self as unknown as WorkerScope;

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

// Per-job cancel flags, set when a cancel request arrives.
const cancelled = new Set<number>();

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

// A runner that checks the cancel flag before each nec2c call and reports
// progress. `onRun` receives the running invocation count.
function instrumentedRunner(id: number, onRun: (runs: number) => void): NecRunner {
  let runs = 0;
  return async (deck: string): Promise<string> => {
    if (cancelled.has(id)) {
      throw new CancelledError();
    }
    runs += 1;
    onRun(runs);
    const out = await baseRunner(deck);
    if (cancelled.has(id)) {
      throw new CancelledError();
    }
    return out;
  };
}

function bundleOf(result: DesignResult): {
  result: DesignResult;
  cutSheet: string;
  resultJson: string;
} {
  return {
    result,
    cutSheet: formatCutSheet(result),
    resultJson: resultsToJson([result]),
  };
}

function optimizedFields(result: DesignResult): OptimizedFields {
  const spec = result.spec;
  return {
    perimeterMm: result.baseFactor * wavelengthM(spec.freqMhz) * 1000.0,
    reflectorSpacingWl: spec.reflectorSpacingWl,
    radialDroopDeg: spec.radialDroopDeg,
    radialCount: spec.radialCount,
  };
}

async function handleAnalyze(
  id: number,
  spec: DesignSpec,
  perimeterMm: number | null,
): Promise<void> {
  const runner = instrumentedRunner(id, () => {});
  const perimeter = perimeterMm ?? estimatePerimeterMm(spec.freqMhz);
  const factor = factorForPerimeter(perimeter, spec.freqMhz);
  const result = await analyzeLiteral(spec, factor, runner);
  post({ id, type: "analyze", bundle: bundleOf(result) });
}

async function handleOptimize(id: number, spec: DesignSpec): Promise<void> {
  const start = Date.now();
  const reflector = spec.reflector !== REFLECTOR_NONE;
  // One label for every phase of Optimize: which solver is running is an
  // implementation detail, and the run counter already shows progress.
  const stage = "whisking…";
  const runner = instrumentedRunner(id, (runs) => {
    post({
      id,
      type: "progress",
      progress: { stage, runs, elapsedS: (Date.now() - start) / 1000.0 },
    });
  });

  let tuned: DesignResult;
  let optimizedSpec: DesignSpec;
  if (reflector) {
    optimizedSpec = await optimizeReflector(spec, runner);
    tuned = await design(optimizedSpec, runner);
  } else {
    // No reflector: Optimize only tunes the perimeter to quadrature.
    tuned = await design(spec, runner);
    optimizedSpec = tuned.spec;
  }

  post({
    id,
    type: "optimize",
    bundle: {
      ...bundleOf(tuned),
      spec: optimizedSpec,
      fields: optimizedFields(tuned),
    },
  });
}

async function handleChartData(id: number, result: DesignResult): Promise<void> {
  const runner = instrumentedRunner(id, () => {});
  const data = await chartData(result, runner);
  post({ id, type: "chartData", data });
}

async function handleSkyData(id: number, result: DesignResult): Promise<void> {
  const runner = instrumentedRunner(id, () => {});
  const data = await skyData(result, runner);
  post({ id, type: "skyData", data });
}

async function dispatch(request: WorkerRequest): Promise<void> {
  try {
    switch (request.kind) {
      case "analyze":
        await handleAnalyze(request.id, request.spec, request.perimeterMm);
        break;
      case "optimize":
        await handleOptimize(request.id, request.spec);
        break;
      case "chartData":
        await handleChartData(request.id, request.result);
        break;
      case "skyData":
        await handleSkyData(request.id, request.result);
        break;
      case "cancel":
        cancelled.add(request.target);
        return;
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      post({ id: request.id, type: "cancelled" });
    } else {
      post({
        id: request.id,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    cancelled.delete(request.id);
  }
}

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void dispatch(event.data);
});
