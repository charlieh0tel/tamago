// Feed/match schematic line art for the selected scheme, rendered by the
// engine's schematic.ts (renderFeedSchematic) from the tuned DesignResult.

import { type DesignResult, renderFeedSchematic } from "../../engine/index";

export function Schematic({ result }: { result: DesignResult }): JSX.Element {
  const connection = result.crossedPhasingLine ? "crossed" : "normal";
  return (
    <div>
      <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: "12.5px" }}>
        Feed and match &mdash; {result.spec.feed} scheme. The {connection} loop B
        connection shown is the one the tool delivers.
      </p>
      <div
        className="schwrap"
        // The SVG string is produced by the engine from its own data.
        dangerouslySetInnerHTML={{ __html: renderFeedSchematic(result) }}
      />
    </div>
  );
}
