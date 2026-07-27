// Print/report view: a single document assembling the title block, a
// provenance line with tool version + git hash, then cut sheet, schematic,
// charts, and sky maps. @media print (theme.css) strips the chrome so the
// browser Print produces the report. Deep-linkable via #report.

import { shareLink } from "../hash";
import { resultsStale } from "../state/reducer";
import type { UiState } from "../state/types";
import { VERSION_PAREN } from "../version";
import { Charts } from "./Charts";
import { Schematic } from "./Schematic";
import { SkyMaps } from "./SkyMaps";

const REPO = "github.com/charlieh0tel/tamago";

export function Report({
  state,
  onBack,
}: {
  state: UiState;
  onBack: () => void;
}): JSX.Element {
  const analysis = state.analysis;
  // Every field describes the analyzed design, not the live editor state, so the
  // printed metadata and design link always reproduce the printed results.
  const spec = analysis?.result.spec ?? state.spec;
  const title = spec.label ? `Eggbeater design — ${spec.label}` : "Eggbeater design";
  const generated = new Date().toISOString().slice(0, 10);
  const link = shareLink(spec);
  const stale = resultsStale(state);

  return (
    <div className="report">
      <div className="report-tools">
        <button type="button" className="mini" onClick={onBack}>
          ← back to designer
        </button>
        <button type="button" className="mini" onClick={() => window.print()}>
          print
        </button>
        <span style={{ color: "var(--muted)", fontSize: "11.5px" }}>
          or use the browser's Print (Ctrl+P)
        </span>
      </div>
      {stale && (
        <div className="report-warn" role="alert">
          <b>Unapplied edits.</b> This report reflects the last analyzed design
          {analysis ? ` (${analysis.result.spec.freqMhz} MHz)` : ""}, not the current
          designer form. Re-analyze to report your edits.
        </div>
      )}
      <h1 className="rtitle">{title}</h1>
      <div className="rmeta">
        tamago awadateki <span lang="ja">卵泡立て器</span> &middot; {spec.freqMhz} MHz
        &middot; {spec.sense.toUpperCase()} &middot; generated {generated}
      </div>
      <div className="rmeta">
        tool <b>{VERSION_PAREN}</b> &middot; {REPO} &middot; design link:{" "}
        <span style={{ wordBreak: "break-all" }}>{link}</span>
      </div>

      {analysis === null ? (
        <div className="ph">Run Analyze or Optimize before printing a report.</div>
      ) : (
        <>
          <section>
            <h2>Cut sheet</h2>
            <pre className="cut">{analysis.cutSheet}</pre>
          </section>
          <section>
            <h2>Feed and match</h2>
            <Schematic result={analysis.result} />
          </section>
          <section className="rcharts">
            <h2>Performance</h2>
            <Charts state={state.charts.state} data={state.charts.data} />
          </section>
          <section>
            <h2>Sky maps</h2>
            <SkyMaps state={state.sky.state} data={state.sky.data} />
          </section>
        </>
      )}
    </div>
  );
}
