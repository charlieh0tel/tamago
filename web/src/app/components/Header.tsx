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

// Balloon whisk in the same stroked line art as the feed schematics: hanging
// loop, tapered handle, and four wires bowing out to a common tip. Drawn as the
// utensil sits (handle up) then turned 180 degrees, which lands it the way the
// antenna stands -- loops up, mast below. Decorative; the brand text alongside
// already names the thing.
function WhiskMark(): JSX.Element {
  return (
    <svg className="whisk" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g transform="rotate(180 12 12)">
        {/* Hanging loop at the butt of the handle. */}
        <circle cx="20.7" cy="3.3" r="1.5" />
        {/* Tapered handle: down one side, across the ferrule, back up the other. */}
        <path d="M17.9 4.2 L10.9 12.4 L12.7 14 L20.1 6.2 Z" />
        {/* Wires, from the ferrule out to a common tip. */}
        <path d="M11.8 13.2 Q13.6 20.2 6.5 19.1" />
        <path d="M11.8 13.2 Q4.7 12.2 6.5 19.1" />
        <path d="M11.8 13.2 Q11.1 17.9 6.5 19.1" />
        <path d="M11.8 13.2 Q7.2 14.4 6.5 19.1" />
      </g>
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
