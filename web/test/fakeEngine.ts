// A synchronous, in-memory EngineService for UI tests -- no worker, no wasm.
// Returns canned bundles so component behaviour (provenance flips, analyze
// flow) can be asserted deterministically.

import type { ChartData, SkyData } from "../src/app/engineExtras";
import type { EngineService, Job } from "../src/app/worker/client";
import type { AnalysisBundle, OptimizeBundle } from "../src/app/worker/protocol";
import {
  type DesignResult,
  type DesignSpec,
  REFLECTOR_RADIALS,
  wavelengthM,
} from "../src/engine/index";

export function fakeResult(spec: DesignSpec, phaseDiffDeg = 89.9): DesignResult {
  return {
    spec,
    baseFactor: 1.052,
    zIn: { re: 45.8, im: -0.0 },
    phaseDiffDeg,
    loopBalance: 1.06,
    crossedPhasingLine: false,
    sense: "RIGHT",
    arBoresightDb: 1.54,
    arConeWorstDb: 3.83,
    arPeakDb: 0.53,
    coverageGainDb: 1.12,
    deck: "CM fake deck\nCE\nEN\n",
  };
}

function bundle(spec: DesignSpec, phase = 89.9): AnalysisBundle {
  return {
    result: fakeResult(spec, phase),
    cutSheet: "Eggbeater cut sheet: FAKE\nFrequency : 145.9 MHz\n",
    resultJson: "{}",
  };
}

export function makeFakeEngine(): EngineService {
  return {
    analyze(spec: DesignSpec): Promise<AnalysisBundle> {
      return Promise.resolve(bundle(spec, 84.1));
    },
    optimize(spec: DesignSpec): Job<OptimizeBundle> {
      const optimizedSpec: DesignSpec = {
        ...spec,
        reflector: spec.reflector,
        reflectorSpacingWl: 0.216,
        radialDroopDeg: 29.5,
        radialCount: spec.reflector === REFLECTOR_RADIALS ? 3 : spec.radialCount,
        optimization: null,
      };
      const perimeterMm = 1.052 * wavelengthM(spec.freqMhz) * 1000.0;
      const out: OptimizeBundle = {
        ...bundle(optimizedSpec, 89.9),
        spec: optimizedSpec,
        fields: {
          perimeterMm,
          reflectorSpacingWl: 0.216,
          radialDroopDeg: 29.5,
          radialCount: optimizedSpec.radialCount,
        },
      };
      return { promise: Promise.resolve(out), cancel: () => {} };
    },
    chartData(): Promise<ChartData> {
      return Promise.resolve({
        label: "2 m",
        f0: 145.9,
        z: { re: 45.8, im: -0.0 },
        sense: "RHCP",
        vswrPost: 1.09,
        arCone: 1.54,
        covGain: 1.12,
        vswrBand: [143.7, 152.9],
        arBand: [143.4, 150.3],
        vswrFreq: [
          [-10, 2.5],
          [0, 1.09],
          [10, 2.5],
        ],
        arFreq: [
          [-10, 5],
          [0, 1.54],
          [10, 5],
        ],
        arElev: [
          [0, 3],
          [90, 1.5],
        ],
        gainElev: [
          [0, -2],
          [90, 1.1],
        ],
      });
    },
    skyData(): Promise<SkyData> {
      return Promise.resolve({
        gainMap: new Map([["0,0", 1.1]]),
        arMap: new Map([["0,0", 0.5]]),
        thetas: [0, 10],
        phis: [0, 15],
      });
    },
  };
}
