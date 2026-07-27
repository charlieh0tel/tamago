// Sky-maps tab: polar az-el heatmaps of gain and axial ratio over the upper
// hemisphere. Ports the rendering of src/awadateki/plot.py (_polar_heatmap,
// _polar_xy, _sector_path, _lerp_color, _colorbar) to a React SVG component,
// fed by the engine's skyData (gainMap / arMap keyed "theta,phi").

import { AR_MAP_MAX_DB, GAIN_MAP_RANGE_DB, type SkyData } from "../engineExtras";
import type { TierState } from "../state/types";

const AXIS_COLOR = "#9FB0AC";
type Cmap = Array<[number, [number, number, number]]>;
const GAIN_CMAP: Cmap = [
  [0.0, [16, 43, 64]],
  [0.55, [33, 120, 110]],
  [1.0, [242, 201, 76]],
];
const AR_CMAP: Cmap = [
  [0.0, [14, 124, 134]],
  [0.5, [200, 136, 28]],
  [1.0, [178, 58, 72]],
];

function hex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function lerpColor(cmap: Cmap, tIn: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, tIn));
  for (let i = 0; i < cmap.length - 1; i++) {
    const [p0, c0] = cmap[i] as [number, [number, number, number]];
    const [p1, c1] = cmap[i + 1] as [number, [number, number, number]];
    if (t <= p1) {
      const f = p1 > p0 ? (t - p0) / (p1 - p0) : 0.0;
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return (cmap[cmap.length - 1] as [number, [number, number, number]])[1];
}

const CX = 150;
const CY = 150;
const RADIUS = 120;

function polarXy(radius: number, theta: number, phi: number): [number, number] {
  const r = (radius * theta) / 90.0;
  const a = (phi * Math.PI) / 180.0;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function sectorPath(t0: number, t1: number, p0: number, p1: number): string {
  const [xo0, yo0] = polarXy(RADIUS, t1, p0);
  const [xo1, yo1] = polarXy(RADIUS, t1, p1);
  const r1 = (RADIUS * t1) / 90.0;
  if (t0 <= 0.0) {
    return `M${CX},${CY} L${xo0.toFixed(1)},${yo0.toFixed(1)} A${r1.toFixed(1)},${r1.toFixed(1)} 0 0 1 ${xo1.toFixed(1)},${yo1.toFixed(1)} Z`;
  }
  const [xi0, yi0] = polarXy(RADIUS, t0, p0);
  const [xi1, yi1] = polarXy(RADIUS, t0, p1);
  const r0 = (RADIUS * t0) / 90.0;
  return (
    `M${xi0.toFixed(1)},${yi0.toFixed(1)} L${xo0.toFixed(1)},${yo0.toFixed(1)} ` +
    `A${r1.toFixed(1)},${r1.toFixed(1)} 0 0 1 ${xo1.toFixed(1)},${yo1.toFixed(1)} ` +
    `L${xi1.toFixed(1)},${yi1.toFixed(1)} A${r0.toFixed(1)},${r0.toFixed(1)} 0 0 0 ${xi0.toFixed(1)},${yi0.toFixed(1)} Z`
  );
}

function PolarHeatmap({
  values,
  thetas,
  phis,
  vmin,
  vmax,
  cmap,
  barLabel,
  name,
}: {
  values: Map<string, number>;
  thetas: readonly number[];
  phis: readonly number[];
  vmin: number;
  vmax: number;
  cmap: Cmap;
  barLabel: string;
  name: string;
}): JSX.Element {
  const span = vmax - vmin || 1.0;
  const sectors: JSX.Element[] = [];
  for (let i = 0; i < thetas.length - 1; i++) {
    const t0 = thetas[i] as number;
    const t1 = thetas[i + 1] as number;
    for (const p0 of phis) {
      const p1 = p0 + 15;
      const corners: number[] = [];
      for (const t of [t0, t1]) {
        for (const p of [p0, p1]) {
          const v = values.get(`${t},${p % 360}`);
          if (v !== undefined) {
            corners.push(v);
          }
        }
      }
      if (corners.length === 0) {
        continue;
      }
      const mean = corners.reduce((a, b) => a + b, 0) / corners.length;
      const color = hex(lerpColor(cmap, (mean - vmin) / span));
      sectors.push(
        <path key={`${t0}-${p0}`} d={sectorPath(t0, t1, p0, p1)} fill={color} />,
      );
    }
  }
  const rings = [30, 60, 90].map((theta) => {
    const r = (RADIUS * theta) / 90.0;
    return (
      <g key={theta}>
        <circle
          cx={CX}
          cy={CY}
          r={r}
          fill="none"
          stroke={AXIS_COLOR}
          strokeWidth={0.8}
          opacity={0.55}
        />
        <text className="tick" x={CX + 3} y={CY - r + 11}>
          {theta}°
        </text>
      </g>
    );
  });
  const azLabels = [0, 90, 180, 270].map((az) => {
    const [lx, ly] = polarXy(RADIUS + 14, 90, az);
    return (
      <text
        key={az}
        className="tick"
        x={lx.toFixed(1)}
        y={(ly + 3).toFixed(1)}
        textAnchor="middle"
      >
        {az}°
      </text>
    );
  });
  const bars: JSX.Element[] = [];
  const bx = 318;
  const by = 50;
  const bw = 12;
  const bh = 190;
  const nbar = 32;
  for (let k = 0; k < nbar; k++) {
    const t = k / (nbar - 1);
    const y = by + bh * (1 - t) - bh / nbar;
    bars.push(
      <rect
        key={k}
        x={bx}
        y={y.toFixed(1)}
        width={bw}
        height={(bh / nbar + 1).toFixed(1)}
        fill={hex(lerpColor(cmap, t))}
      />,
    );
  }
  return (
    <svg
      viewBox="0 0 360 300"
      role="img"
      aria-label={name}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{name}</title>
      {sectors}
      {rings}
      {azLabels}
      {bars}
      <text className="tick" x={bx + bw + 4} y={by + 4}>
        {vmax.toFixed(0)}
      </text>
      <text className="tick" x={bx + bw + 4} y={by + bh}>
        {vmin.toFixed(0)}
      </text>
      <text className="tick" x={bx + bw / 2} y={by - 8} textAnchor="middle">
        {barLabel}
      </text>
    </svg>
  );
}

function gainMax(data: SkyData): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of data.gainMap.values()) {
    max = Math.max(max, v);
  }
  return Number.isFinite(max) ? max : 0.0;
}

export function SkyMaps({
  state,
  data,
}: {
  state: TierState;
  data: SkyData | null;
}): JSX.Element {
  if (data === null) {
    if (state === "loading") {
      return <div className="ph">Sampling the upper hemisphere…</div>;
    }
    if (state === "error") {
      return <div className="ph">The sky sampling failed. Re-run Analyze.</div>;
    }
    return (
      <div className="ph">Analyze first, then open this tab to sample the sky.</div>
    );
  }
  const gmax = Math.ceil(gainMax(data));
  const staleNote = state === "stale" ? " (stale)" : "";
  return (
    <>
      <div className="polar">
        <figure className="chart" style={{ flex: 1, minWidth: 260 }}>
          <figcaption>Gain over the sky{staleNote}</figcaption>
          <PolarHeatmap
            values={data.gainMap}
            thetas={data.thetas}
            phis={data.phis}
            vmin={gmax - GAIN_MAP_RANGE_DB}
            vmax={gmax}
            cmap={GAIN_CMAP}
            barLabel="dBi"
            name={`Gain over the sky, polar plot: zenith at center, horizon at rim, peak ${gmax} dBi`}
          />
        </figure>
        <figure className="chart" style={{ flex: 1, minWidth: 260 }}>
          <figcaption>Axial ratio over the sky{staleNote}</figcaption>
          <PolarHeatmap
            values={data.arMap}
            thetas={data.thetas}
            phis={data.phis}
            vmin={0}
            vmax={AR_MAP_MAX_DB}
            cmap={AR_CMAP}
            barLabel="dB"
            name="Axial ratio over the sky, polar plot: zenith at center, horizon at rim"
          />
        </figure>
      </div>
      <p className="polar-note">
        Center = zenith (overhead); outer ring = horizon. Rings mark zenith angle
        (0–90°); azimuth 0° at top, increasing clockwise.
      </p>
    </>
  );
}
