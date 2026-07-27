// Analysis summary strip: the handful of RF metrics a builder decides on, each
// with a pass/warn cue against its target. Attention (amber) is drawn only to
// metrics that miss a target, so "quadrature achieved but AR target missed" can
// never be misread from the header chip alone.

import {
  AR_TARGET_DB,
  type DesignResult,
  FEASIBLE_VSWR,
  NEC_SENSE_TO_HAND,
  matchedVswr,
} from "../../engine/index";

function signed(x: number): string {
  return `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}`;
}

interface Metric {
  label: string;
  value: string;
  // "pass"/"warn" show a cue; undefined is an informational value with no target.
  state?: "pass" | "warn";
}

function metrics(result: DesignResult): Metric[] {
  const spec = result.spec;
  const arBudget = AR_TARGET_DB - spec.arMarginDb;
  const vswr = matchedVswr(spec, result.zIn);
  const achieved = NEC_SENSE_TO_HAND[result.sense] ?? result.sense;
  const wanted = spec.sense;
  const quadrature = Math.abs(Math.abs(result.phaseDiffDeg) - 90) <= 1.0;
  return [
    {
      label: "Quadrature",
      value: `${signed(result.phaseDiffDeg)}°`,
      state: quadrature ? "pass" : "warn",
    },
    { label: "Loop balance", value: result.loopBalance.toFixed(2) },
    {
      label: "Feed Z",
      value: `${result.zIn.re.toFixed(1)} ${signed(result.zIn.im)}j Ω`,
    },
    {
      label: `VSWR (< ${FEASIBLE_VSWR})`,
      value: vswr.toFixed(2),
      state: vswr <= FEASIBLE_VSWR ? "pass" : "warn",
    },
    {
      label: `AR boresight (< ${arBudget.toFixed(1)})`,
      value: `${result.arBoresightDb.toFixed(2)} dB`,
      state: result.arBoresightDb <= arBudget ? "pass" : "warn",
    },
    {
      label: `AR cone worst (< ${AR_TARGET_DB.toFixed(1)})`,
      value: `${result.arConeWorstDb.toFixed(2)} dB`,
      state: result.arConeWorstDb <= AR_TARGET_DB ? "pass" : "warn",
    },
    { label: "Coverage gain", value: `${signed(result.coverageGainDb)} dB` },
    {
      label: "Sense",
      value:
        achieved === wanted
          ? achieved.toUpperCase()
          : `${achieved.toUpperCase()} (want ${wanted.toUpperCase()})`,
      state: achieved === wanted ? "pass" : "warn",
    },
  ];
}

export function Summary({ result }: { result: DesignResult }): JSX.Element {
  return (
    <div className="summary" role="group" aria-label="analysis summary">
      {metrics(result).map((m) => (
        <div key={m.label} className={`metric${m.state ? ` ${m.state}` : ""}`}>
          <span className="metric-label">{m.label}</span>
          <span className="metric-value">
            {m.value}
            {m.state === "warn" && <span className="metric-flag"> ⚠</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
