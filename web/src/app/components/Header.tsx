// Header strip: brand, repo link, tool-version chip, the always-visible status
// chips (tuning state, achieved sense, delivered loop-B connection), and the
// copy-design-link button (docs/web-ux.md).

import { NEC_SENSE_TO_HAND } from "../../engine/index";
import type { UiState } from "../state/types";
import { VERSION_LABEL } from "../version";

const REPO_URL = "https://github.com/charlieh0tel/tamago";

function signed(x: number): string {
  return `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}`;
}

// Balloon whisk in the same stroked line art as the feed schematics: a tapered
// handle at the lower left and four wires bowing into a long teardrop at the
// upper right, the way the antenna stands -- loops up, mast below. Decorative;
// the brand text alongside already names the thing.
//
// The wire cubics share their along-axis control fractions (0.30 and 0.72) and
// differ only in how far they bow off it, which is what puts the widest part of
// the teardrop past the midpoint instead of at it.
function WhiskMark(): JSX.Element {
  return (
    <svg className="whisk" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* Tapered handle: up one side, across the ferrule, back down the other. */}
      <path d="M2.4 19.4 L10.2 12.2 L11.8 13.8 L4.6 21.6 Z" />
      {/* Wires, ferrule to a common tip, two bows per side. */}
      <path d="M11 13 C16.1 12.1 21.9 9.5 21 3" />
      <path d="M11 13 C11.9 7.9 14.5 2.1 21 3" />
      <path d="M11 13 C14.9 10.9 19.9 7.5 21 3" />
      <path d="M11 13 C13.1 9.1 16.5 4.1 21 3" />
    </svg>
  );
}

function TuningChip({ state }: { state: UiState }): JSX.Element {
  const { status, analysis } = state;
  const phase = analysis ? signed(analysis.result.phaseDiffDeg) : "";
  if (status === "tuned") {
    // The check asserts the phase only; performance vs targets is in the
    // results summary, not implied here.
    return (
      <span
        className="chip"
        title="Loop currents are 90° apart — the quadrature that makes the pattern circularly polarized. The number is the achieved loop A minus loop B current phase."
      >
        quadrature <b>✓ {phase}°</b>
      </span>
    );
  }
  if (status === "analyzed") {
    return (
      <span
        className="chip tuning"
        title="Analyzed at the current dimensions but not tuned to 90° quadrature. Run Optimize to tune the perimeter."
      >
        analyzed — <b>phase {phase}°, not quadrature</b>
      </span>
    );
  }
  if (status === "analyzing") {
    return (
      <span className="chip" title="Running nec2c on the current design…">
        analyzing…
      </span>
    );
  }
  if (status === "optimizing") {
    return (
      <span
        className="chip"
        title="Tuning the perimeter to quadrature and searching the reflector…"
      >
        optimizing…
      </span>
    );
  }
  if (status === "fresh") {
    return (
      <span className="chip" title="Nothing analyzed yet. Press Analyze.">
        not analyzed — press Analyze
      </span>
    );
  }
  return (
    <span
      className="chip tuning"
      title="The design changed since the last analysis. Press Analyze to update the results."
    >
      edited — <b>not analyzed</b>
    </span>
  );
}

export function Header({
  state,
  onCopyLink,
}: {
  state: UiState;
  onCopyLink: () => void;
}): JSX.Element {
  const analysis = state.analysis;
  const achieved = analysis ? NEC_SENSE_TO_HAND[analysis.result.sense] : undefined;
  const wanted = state.spec.sense;
  return (
    <header>
      <span className="brand">
        <WhiskMark />
        tamago awadateki
        <span className="jp" lang="ja">
          卵泡立て器
        </span>
        <span className="jp">Egg Beater</span>
      </span>
      <a
        className="chip repo"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        charlieh0tel/tamago
      </a>
      <span className="chip ver" title="tool version">
        {VERSION_LABEL}
      </span>
      <span className="spacer" />
      <span className="chips">
        <TuningChip state={state} />
        {analysis && (
          <span
            className="chip"
            title="Achieved circular-polarization handedness (from the modeled pattern) versus the sense you requested."
          >
            sense{" "}
            <b>
              {achieved === wanted
                ? `${wanted.toUpperCase()} achieved`
                : `${(achieved ?? analysis.result.sense).toUpperCase()} (wanted ${wanted.toUpperCase()})`}
            </b>
          </span>
        )}
        {analysis && (
          <span
            className="chip"
            title="How the phasing line connects to loop B. 'crossed' swaps the two conductors at loop B to deliver the requested sense; 'normal' is straight through. See the schematic."
          >
            {analysis.result.crossedPhasingLine ? "crossed" : "normal"} line to loop B
          </span>
        )}
      </span>
      <button type="button" className="linkbtn" onClick={onCopyLink}>
        copy design link
      </button>
    </header>
  );
}
