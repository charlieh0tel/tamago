// Charts tab: VSWR and axial-ratio versus frequency offset, as React SVG with
// the 2:1 / 3 dB limit lines and a hover crosshair tooltip. Ports the mockup's
// chart geometry (docs/web-ux-mockup.html) and consumes the engine's chartData
// (vswrFreq / arFreq series, in percent offset from the design frequency).

import { type MouseEvent, useRef, useState } from "react";
import type { ChartData } from "../engineExtras";
import type { TierState } from "../state/types";

const W = 440;
const H = 250;
const ML = 44;
const MR = 12;
const MT = 12;
const MB = 34;

const sx = (x: number): number => ML + ((x + 10) / 20) * (W - ML - MR);
const sy = (y: number, ymin: number, ymax: number): number =>
  H - MB - ((y - ymin) / (ymax - ymin)) * (H - MT - MB);

interface Tip {
  left: number;
  top: number;
  text: string;
}

// A series point: [percent offset from f0, value].
type Pair = [number, number];

// The peak point of each contiguous run that exceeds ymax, so a curve clamped
// to the top edge is flagged (and its true value shown) rather than reading as
// a flat line at the ceiling. Both band edges are flagged for a U-shaped curve.
function offScaleRunPeaks(points: Pair[], ymax: number): Pair[] {
  const peaks: Pair[] = [];
  let inRun = false;
  for (const p of points) {
    if (p[1] > ymax) {
      const last = peaks[peaks.length - 1];
      if (!inRun) {
        peaks.push(p);
      } else if (last !== undefined && p[1] > last[1]) {
        peaks[peaks.length - 1] = p;
      }
      inRun = true;
    } else {
      inRun = false;
    }
  }
  return peaks;
}

function Chart({
  points,
  ymin,
  ymax,
  yticks,
  limit,
  limitText,
  format,
}: {
  points: Pair[];
  ymin: number;
  ymax: number;
  yticks: number[];
  limit: number;
  limitText: string;
  format: (value: number) => string;
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<Pair | null>(null);

  const onMove = (e: MouseEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (svg === null || points.length === 0) {
      return;
    }
    const r = svg.getBoundingClientRect();
    const fx = ((((e.clientX - r.left) / r.width) * W - ML) / (W - ML - MR)) * 20 - 10;
    let best = points[0] as Pair;
    for (const p of points) {
      if (Math.abs(p[0] - fx) < Math.abs(best[0] - fx)) {
        best = p;
      }
    }
    setHover(best);
    setTip({
      left: e.clientX,
      top: e.clientY,
      text: `${best[0] >= 0 ? "+" : ""}${best[0].toFixed(1)}%  ·  ${format(best[1])}`,
    });
  };

  const poly = points
    .map(
      (p) =>
        `${sx(p[0]).toFixed(1)},${sy(Math.min(p[1], ymax), ymin, ymax).toFixed(1)}`,
    )
    .join(" ");

  const offPeaks = offScaleRunPeaks(points, ymax);

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null);
          setHover(null);
        }}
      >
        {yticks.map((ty) => (
          <g key={ty}>
            <line
              x1={ML}
              y1={sy(ty, ymin, ymax)}
              x2={W - MR}
              y2={sy(ty, ymin, ymax)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              className="tick"
              x={ML - 6}
              y={sy(ty, ymin, ymax) + 3}
              textAnchor="end"
            >
              {ty}
            </text>
          </g>
        ))}
        {[-10, -5, 0, 5, 10].map((tx) => (
          <text
            key={tx}
            className="tick"
            x={sx(tx)}
            y={H - MB + 14}
            textAnchor="middle"
          >
            {tx > 0 ? `+${tx}` : tx}
          </text>
        ))}
        <line
          x1={ML}
          y1={sy(limit, ymin, ymax)}
          x2={W - MR}
          y2={sy(limit, ymin, ymax)}
          stroke="var(--limit)"
          strokeWidth={1.3}
          strokeDasharray="5 4"
        />
        <text
          className="limitlbl"
          x={W - MR - 4}
          y={sy(limit, ymin, ymax) - 5}
          textAnchor="end"
        >
          {limitText}
        </text>
        <rect
          x={ML}
          y={MT}
          width={W - ML - MR}
          height={H - MT - MB}
          fill="none"
          stroke="var(--line)"
          strokeWidth={1.1}
        />
        <polyline
          points={poly}
          fill="none"
          stroke="var(--teal)"
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        {offPeaks.map((p) => (
          <g className="offscale" key={p[0]}>
            <path d={`M${sx(p[0]).toFixed(1)},${MT + 1} l-4.5,7 l9,0 z`} />
            <title>{`off scale: ${format(p[1])}`}</title>
            <text x={sx(p[0])} y={MT + 20} textAnchor="middle">
              {p[1].toFixed(1)}
            </text>
          </g>
        ))}
        <text className="axis" x={(ML + W - MR) / 2} y={H - 4} textAnchor="middle">
          frequency offset (%)
        </text>
        {hover && (
          <>
            <line
              x1={sx(hover[0])}
              y1={MT}
              x2={sx(hover[0])}
              y2={H - MB}
              stroke="var(--muted)"
              strokeWidth={0.8}
            />
            <circle
              cx={sx(hover[0])}
              cy={sy(Math.min(hover[1], ymax), ymin, ymax)}
              r={3}
              fill="var(--teal)"
            />
          </>
        )}
      </svg>
      {tip && (
        <div className="tip" style={{ left: tip.left, top: tip.top, display: "block" }}>
          {tip.text}
        </div>
      )}
    </>
  );
}

function bandNote(band: [number, number] | null, unitLabel: string): string {
  if (band === null) {
    return `${unitLabel}: limit not met at the design frequency.`;
  }
  return `${unitLabel} band ${band[0].toFixed(1)}–${band[1].toFixed(1)} MHz.`;
}

export function Charts({
  state,
  data,
}: {
  state: TierState;
  data: ChartData | null;
}): JSX.Element {
  if (data === null) {
    if (state === "loading") {
      return <div className="ph">Computing the frequency sweep…</div>;
    }
    if (state === "error") {
      return <div className="ph">The frequency sweep failed. Re-run Analyze.</div>;
    }
    return (
      <div className="ph">Analyze first, then open this tab to sweep VSWR and AR.</div>
    );
  }
  const staleNote = state === "stale" ? " (stale — edits since this sweep)" : "";
  return (
    <div className="chartrow">
      <figure className="chart">
        <figcaption>VSWR vs frequency{staleNote}</figcaption>
        <Chart
          points={data.vswrFreq}
          ymin={1}
          ymax={3}
          yticks={[1, 1.5, 2, 2.5, 3]}
          limit={2.0}
          limitText="2:1"
          format={(v) => `VSWR ${v.toFixed(2)}`}
        />
        <p className="note">
          Matched VSWR; dashed line marks 2:1. {bandNote(data.vswrBand, "VSWR")}
        </p>
      </figure>
      <figure className="chart">
        <figcaption>Axial ratio vs frequency{staleNote}</figcaption>
        <Chart
          points={data.arFreq}
          ymin={0}
          ymax={10}
          yticks={[0, 2, 4, 6, 8, 10]}
          limit={3.0}
          limitText="3 dB"
          format={(v) => `${v.toFixed(2)} dB`}
        />
        <p className="note">
          Cone-mean AR; 3 dB crossings bound usable CP coverage.{" "}
          {bandNote(data.arBand, "AR")}
        </p>
      </figure>
    </div>
  );
}
