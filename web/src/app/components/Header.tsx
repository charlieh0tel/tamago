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

function TuningChip({ state }: { state: UiState }): JSX.Element {
  const { status, analysis } = state;
  const phase = analysis ? signed(analysis.result.phaseDiffDeg) : "";
  if (status === "tuned") {
    // The check asserts the phase only; performance vs targets is in the
    // results summary, not implied here.
    return (
      <span className="chip">
        quadrature <b>✓ {phase}°</b>
      </span>
    );
  }
  if (status === "analyzed") {
    return (
      <span className="chip tuning">
        analyzed — <b>phase {phase}°, not quadrature</b>
      </span>
    );
  }
  if (status === "analyzing") {
    return <span className="chip">analyzing…</span>;
  }
  if (status === "optimizing") {
    return <span className="chip">optimizing…</span>;
  }
  if (status === "fresh") {
    return <span className="chip">not analyzed — press Analyze</span>;
  }
  return (
    <span className="chip tuning">
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
          <span className="chip">
            sense{" "}
            <b>
              {achieved === wanted
                ? `${wanted.toUpperCase()} achieved`
                : `${(achieved ?? analysis.result.sense).toUpperCase()} (wanted ${wanted.toUpperCase()})`}
            </b>
          </span>
        )}
        {analysis && (
          <span className="chip">
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
