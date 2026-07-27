// Analysis summary strip: the handful of RF metrics a builder decides on, each
// with a pass/warn cue against its target. Attention (amber) is drawn only to
// metrics that miss a target, so "quadrature achieved but AR target missed" can
// never be misread from the header chip alone.

import {
  AR_TARGET_DB,
  BORESIGHT_THETA_DEG,
  COVERAGE_THETA_DEG,
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
  // Hover explanation of what the metric is and its target.
  hint: string;
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
      hint: "Loop current phase difference (loop A minus loop B). 90° is the quadrature that produces circular polarization.",
      state: quadrature ? "pass" : "warn",
    },
    {
      label: "Loop balance",
      value: result.loopBalance.toFixed(2),
      hint: "Ratio of loop current magnitudes |I_B| / |I_A|. 1.0 is equal drive (needed, with quadrature, for circularity).",
    },
    {
      label: "Feed Z",
      value: `${result.zIn.re.toFixed(1)} ${signed(result.zIn.im)}j Ω`,
      hint: "Feedpoint impedance at the harness source (junction or port), before the match network or balun.",
    },
    ...(result.loopAFeedZ && result.loopBFeedZ
      ? [
          {
            label: "Loop A feed Z",
            value: `${result.loopAFeedZ.re.toFixed(1)} ${signed(result.loopAFeedZ.im)}j Ω`,
            hint: "Active driving-point impedance at loop A's feed gap, both loops driven in the delivered quadrature (mutual coupling included).",
          },
          {
            label: "Loop B feed Z",
            value: `${result.loopBFeedZ.re.toFixed(1)} ${signed(result.loopBFeedZ.im)}j Ω`,
            hint: "Active driving-point impedance at loop B's feed gap, both loops driven in the delivered quadrature (mutual coupling included).",
          },
        ]
      : []),
    {
      label: `VSWR (< ${FEASIBLE_VSWR})`,
      value: vswr.toFixed(2),
      hint: `Post-match VSWR at the design frequency into ${spec.systemZOhm.toFixed(0)} Ω. Target below ${FEASIBLE_VSWR}.`,
      state: vswr <= FEASIBLE_VSWR ? "pass" : "warn",
    },
    {
      label: `AR boresight (< ${arBudget.toFixed(1)})`,
      value: `${result.arBoresightDb.toFixed(2)} dB`,
      hint: `Mean axial ratio over the coverage cone (within ${BORESIGHT_THETA_DEG}° of zenith). 0 dB is perfectly circular; target below ${arBudget.toFixed(1)} dB (3 dB minus the AR margin).`,
      state: result.arBoresightDb <= arBudget ? "pass" : "warn",
    },
    {
      label: `AR cone worst (< ${AR_TARGET_DB.toFixed(1)})`,
      value: `${result.arConeWorstDb.toFixed(2)} dB`,
      hint: `Worst axial ratio anywhere in the coverage cone. Target below ${AR_TARGET_DB.toFixed(1)} dB.`,
      state: result.arConeWorstDb <= AR_TARGET_DB ? "pass" : "warn",
    },
    {
      label: "Coverage gain",
      value: `${signed(result.coverageGainDb)} dB`,
      hint: `Worst-case total gain over the operational cone (within ${COVERAGE_THETA_DEG}° of zenith), dBi.`,
    },
    {
      label: "Sense",
      value:
        achieved === wanted
          ? achieved.toUpperCase()
          : `${achieved.toUpperCase()} (want ${wanted.toUpperCase()})`,
      hint: "Achieved circular-polarization handedness (from the modeled pattern) versus the sense you requested.",
      state: achieved === wanted ? "pass" : "warn",
    },
  ];
}

export function Summary({ result }: { result: DesignResult }): JSX.Element {
  return (
    <div className="summary" role="group" aria-label="analysis summary">
      {metrics(result).map((m) => (
        <div
          key={m.label}
          className={`metric${m.state ? ` ${m.state}` : ""}`}
          title={m.hint}
        >
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
