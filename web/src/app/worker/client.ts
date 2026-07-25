// Main-thread client for the engine worker. Presents a small typed service so
// components (and tests, via a fake implementation) never touch postMessage.

import type { DesignResult, DesignSpec } from "../../engine/index";
import type { ChartData, SkyData } from "../engineExtras";
import type {
  AnalysisBundle,
  OptimizeBundle,
  OptimizeProgress,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

// A cancellable job: await `promise`; call `cancel()` to abort (rejects with a
// CancelledError-flavoured Error).
export interface Job<T> {
  promise: Promise<T>;
  cancel(): void;
}

export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

export interface EngineService {
  analyze(spec: DesignSpec, perimeterMm: number | null): Promise<AnalysisBundle>;
  optimize(
    spec: DesignSpec,
    onProgress: (p: OptimizeProgress) => void,
  ): Job<OptimizeBundle>;
  chartData(result: DesignResult): Promise<ChartData>;
  skyData(result: DesignResult): Promise<SkyData>;
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  onProgress?: (p: OptimizeProgress) => void;
}

export class WorkerEngine implements EngineService {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(worker?: Worker) {
    this.worker =
      worker ??
      new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      this.onMessage(event.data);
    });
  }

  private onMessage(message: WorkerResponse): void {
    const entry = this.pending.get(message.id);
    if (entry === undefined) {
      return;
    }
    switch (message.type) {
      case "progress":
        entry.onProgress?.(message.progress);
        return;
      case "analyze":
        this.pending.delete(message.id);
        entry.resolve(message.bundle);
        return;
      case "optimize":
        this.pending.delete(message.id);
        entry.resolve(message.bundle);
        return;
      case "chartData":
        this.pending.delete(message.id);
        entry.resolve(message.data);
        return;
      case "skyData":
        this.pending.delete(message.id);
        entry.resolve(message.data);
        return;
      case "cancelled":
        this.pending.delete(message.id);
        entry.reject(new CancelledError());
        return;
      case "error":
        this.pending.delete(message.id);
        entry.reject(new Error(message.message));
        return;
    }
  }

  private send(request: WorkerRequest): void {
    this.worker.postMessage(request);
  }

  private request<T>(
    build: (id: number) => WorkerRequest,
    onProgress?: (p: OptimizeProgress) => void,
  ): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      this.send(build(id));
    });
    return { id, promise };
  }

  analyze(spec: DesignSpec, perimeterMm: number | null): Promise<AnalysisBundle> {
    return this.request<AnalysisBundle>((id) => ({
      id,
      kind: "analyze",
      spec,
      perimeterMm,
    })).promise;
  }

  optimize(
    spec: DesignSpec,
    onProgress: (p: OptimizeProgress) => void,
  ): Job<OptimizeBundle> {
    const { id, promise } = this.request<OptimizeBundle>(
      (jobId) => ({ id: jobId, kind: "optimize", spec }),
      onProgress,
    );
    return {
      promise,
      cancel: () => this.send({ id: this.nextId++, kind: "cancel", target: id }),
    };
  }

  chartData(result: DesignResult): Promise<ChartData> {
    return this.request<ChartData>((id) => ({ id, kind: "chartData", result })).promise;
  }

  skyData(result: DesignResult): Promise<SkyData> {
    return this.request<SkyData>((id) => ({ id, kind: "skyData", result })).promise;
  }
}
