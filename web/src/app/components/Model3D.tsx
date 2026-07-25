// 3-D model tab: an orbit/zoom wire viewer fed by tunedGeometry. React port of
// src/awadateki/viewer.js -- orthographic, z up; drag orbits, wheel zooms.

import { useEffect, useRef } from "react";
import type { DesignResult } from "../../engine/index";
import { tunedGeometry, wireColorIndex } from "../engineExtras";

const COLORS = ["#0E7C86", "#6D4AA7", "#8A9A96"];
const FEED = "#B23A48";

export function Model3D({ result }: { result: DesignResult | null }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || result === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    const { wires, feeds } = tunedGeometry(result);

    const pts: number[][] = [];
    for (const w of wires) {
      pts.push([w.x1, w.y1, w.z1], [w.x2, w.y2, w.z2]);
    }
    for (const f of feeds) {
      pts.push(f);
    }
    const c: [number, number, number] = [0, 0, 0];
    for (const p of pts) {
      c[0] += p[0] as number;
      c[1] += p[1] as number;
      c[2] += p[2] as number;
    }
    c[0] /= pts.length;
    c[1] /= pts.length;
    c[2] /= pts.length;
    let rad = 1e-6;
    for (const p of pts) {
      rad = Math.max(
        rad,
        Math.hypot(
          (p[0] as number) - c[0],
          (p[1] as number) - c[1],
          (p[2] as number) - c[2],
        ),
      );
    }

    const st = { yaw: 0.6, pitch: -0.45, zoom: 1 };
    let W = 300;
    let Hh = 300;

    const proj = (p: number[]): number[] => {
      const x = (p[0] as number) - c[0];
      const y = (p[1] as number) - c[1];
      const z = (p[2] as number) - c[2];
      const cy = Math.cos(st.yaw);
      const syaw = Math.sin(st.yaw);
      const x1 = x * cy - y * syaw;
      const y1 = x * syaw + y * cy;
      const cp = Math.cos(st.pitch);
      const sp = Math.sin(st.pitch);
      const up = y1 * sp + z * cp;
      const depth = y1 * cp - z * sp;
      const s = ((Math.min(W, Hh) / 2 - 16) / rad) * st.zoom;
      return [W / 2 + x1 * s, Hh / 2 - up * s, depth];
    };

    const draw = (): void => {
      ctx.clearRect(0, 0, W, Hh);
      const segs = wires.map((w) => {
        const a = proj([w.x1, w.y1, w.z1]);
        const b = proj([w.x2, w.y2, w.z2]);
        return {
          a,
          b,
          ci: wireColorIndex(w.tag),
          d: ((a[2] as number) + (b[2] as number)) / 2,
        };
      });
      segs.sort((m, nn) => nn.d - m.d);
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      for (const e of segs) {
        ctx.strokeStyle = COLORS[e.ci] ?? COLORS[2] ?? "#888";
        ctx.beginPath();
        ctx.moveTo(e.a[0] as number, e.a[1] as number);
        ctx.lineTo(e.b[0] as number, e.b[1] as number);
        ctx.stroke();
      }
      ctx.fillStyle = FEED;
      for (const f of feeds) {
        const p = proj(f);
        ctx.beginPath();
        ctx.arc(p[0] as number, p[1] as number, 3.6, 0, 6.2832);
        ctx.fill();
      }
    };

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const css = canvas.clientWidth || 300;
      canvas.width = css * dpr;
      canvas.height = css * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = css;
      Hh = css;
      draw();
    };

    let drag = false;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent): void => {
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onUp = (): void => {
      drag = false;
    };
    const onMoveP = (e: PointerEvent): void => {
      if (!drag) {
        return;
      }
      st.yaw += (e.clientX - lx) * 0.01;
      st.pitch += (e.clientY - ly) * 0.01;
      st.pitch = Math.max(-1.5, Math.min(1.5, st.pitch));
      lx = e.clientX;
      ly = e.clientY;
      draw();
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      st.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
      st.zoom = Math.max(0.3, Math.min(6, st.zoom));
      draw();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMoveP);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", resize);
    resize();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMoveP);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", resize);
    };
  }, [result]);

  if (result === null) {
    return <div className="ph">Run Analyze or Optimize to build the wire model.</div>;
  }
  return (
    <div>
      <canvas
        ref={canvasRef}
        className="viewer-canvas"
        aria-label="Interactive 3-D wire model; drag to orbit, scroll to zoom"
      />
      <div className="legend">
        <span style={{ color: COLORS[0] }}>loop A</span>
        <span style={{ color: COLORS[1] }}>loop B</span>
        <span style={{ color: COLORS[2] }}>radial</span>
        <span style={{ color: FEED }}>feed point</span>
      </div>
    </div>
  );
}
