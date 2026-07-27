// Feed/match schematic line art for the selected scheme, rendered by the
// engine's schematic.ts (renderFeedSchematic) from the tuned DesignResult.

import { type DesignResult, renderFeedSchematic } from "../../engine/index";

export function Schematic({ result }: { result: DesignResult }): JSX.Element {
  const crossed = result.crossedPhasingLine;
  const sense = result.spec.sense.toUpperCase();
  return (
    <div>
      <div className={`conn-callout${crossed ? " crossed" : ""}`}>
        {crossed ? (
          <>
            <b>Loop B: CROSSED.</b> Swap the two conductors where the line meets Loop B
            — required to deliver {sense}. Wiring it straight through gives the opposite
            sense.
          </>
        ) : (
          <>
            <b>Loop B: normal.</b> Connect the line straight through to Loop B (no
            conductor swap) for {sense}.
          </>
        )}
      </div>
      <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: "12.5px" }}>
        Feed and match &mdash; {result.spec.feed} scheme, as the tool delivers it.
      </p>
      <div
        className="schwrap"
        // The SVG string is produced by the engine from its own data.
        dangerouslySetInnerHTML={{ __html: renderFeedSchematic(result) }}
      />
    </div>
  );
}
