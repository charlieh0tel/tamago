// Canonical feed/match schematic, rendered as inline SVG line art. Port of
// src/awadateki/schematic.py.
//
// Classic two-conductor schematic drawing (handbook style): open-circle
// terminals, inductor humps / capacitor plates, coax sections drawn as a
// shield cylinder with circular end faces around the center conductor (shield
// pigtails to the return at each end), filled junction dots, a hop where
// conductors cross without connecting, and full-wave loops drawn as a circle
// broken at the feed gap. A crossed phasing line is drawn as an actual
// conductor swap.
//
// The numbers come from resultToDict(result).build, the same source as the
// cut sheet, so the drawing cannot diverge from the other outputs.

import type { DesignResult } from "./design";
import { formatG } from "./format";
import { resultToDict } from "./result";
import type { JsonObject } from "./spec";

// Conductor pair geometry: the hot rail runs RAIL_GAP above the return rail.
const RAIL_GAP = 40.0;
// Half-angle of the feed-gap break in a loop symbol, degrees.
const LOOP_GAP_DEG = 25.0;
const LOOP_RADIUS = 42.0;
// Coax shield cylinder: half-height around the center conductor, and the
// radius of the circular end faces.
const COAX_RY = 8.0;
const TERMINAL_RADIUS = 3.5;
const DOT_RADIUS = 3.0;
const HOP_RADIUS = 7.0;

function obj(v: unknown): JsonObject {
  return v as JsonObject;
}

// Python str(float) for a whole-number constant embedded bare in an f-string
// (e.g. r="{COAX_RY}"): JS number-to-string drops the trailing ".0" that
// Python keeps, so radii/lengths interpolated without a format spec need
// this to match byte-for-byte.
function pyFloat(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : `${x}`;
}

function text(x: number, y: number, s: string, anchor = "middle"): string {
  return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="${anchor}">${s}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
}

function dot(x: number, y: number): string {
  return `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pyFloat(DOT_RADIUS)}"/>`;
}

// Open-circle terminal on each conductor (the feedline attachment).
function terminalPair(x: number, yTop: number): string {
  return (
    `<circle cx="${x.toFixed(1)}" cy="${yTop.toFixed(1)}" r="${pyFloat(TERMINAL_RADIUS)}"/>` +
    `<circle cx="${x.toFixed(1)}" cy="${(yTop + RAIL_GAP).toFixed(1)}" r="${pyFloat(TERMINAL_RADIUS)}"/>`
  );
}

// Series inductor in a conductor: four semicircular humps.
function inductor(x0: number, x1: number, y: number): string {
  const humps = 4;
  const r = (x1 - x0) / (2.0 * humps);
  const arcs = Array.from(
    { length: humps },
    () => `a${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${(2 * r).toFixed(1)},0`,
  ).join("");
  return `<path d="M${x0.toFixed(1)},${y.toFixed(1)} ${arcs}"/>`;
}

// Series capacitor in a conductor: two plates with a gap.
function capacitor(x0: number, x1: number, y: number): string {
  const mid = (x0 + x1) / 2.0;
  const halfGap = 4.0;
  const plate = 11.0;
  return (
    line(x0, y, mid - halfGap, y) +
    line(mid - halfGap, y - plate, mid - halfGap, y + plate) +
    line(mid + halfGap, y - plate, mid + halfGap, y + plate) +
    line(mid + halfGap, y, x1, y)
  );
}

// Coax section: the shield drawn as a cylinder around the center conductor,
// with a pigtail from each end of the shield down to the return conductor.
//
// The center conductor itself is the caller's hot rail passing through; the
// return conductor stops at the pigtails (inside the run, the shield is the
// return path).
function coaxSection(
  x0: number,
  x1: number,
  yHot: number,
  yRet: number,
  labelLines: readonly string[],
): string {
  const r = COAX_RY;
  const walls = line(x0, yHot - r, x1, yHot - r) + line(x0, yHot + r, x1, yHot + r);
  const ends = [x0, x1]
    .map(
      (x) => `<circle cx="${x.toFixed(1)}" cy="${yHot.toFixed(1)}" r="${pyFloat(r)}"/>`,
    )
    .join("");
  const pigtails = line(x0, yHot + r, x0, yRet) + line(x1, yHot + r, x1, yRet);
  const parts = [walls, ends, pigtails];
  let y = yHot - r - 12.0 - 13.0 * (labelLines.length - 1);
  for (const s of labelLines) {
    parts.push(text((x0 + x1) / 2.0, y, s));
    y += 13.0;
  }
  return parts.join("");
}

// Shield cylinder walls and end faces around a conductor at y.
function coaxBody(x0: number, x1: number, y: number): string {
  const r = COAX_RY;
  const walls = line(x0, y - r, x1, y - r) + line(x0, y + r, x1, y + r);
  const ends = [x0, x1]
    .map((x) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pyFloat(r)}"/>`)
    .join("");
  return walls + ends;
}

// Two coax in parallel: center conductors jumpered together at both ends,
// braids bonded at both ends, shields returning via pigtails.
function parallelPairSection(
  x0: number,
  x1: number,
  yHot: number,
  yRet: number,
  labelLines: readonly string[],
): string {
  const r = COAX_RY;
  const yUp = yHot - 26.0; // the second coax rides above the rail
  const xJ0 = x0 - 12.0;
  const xJ1 = x1 + 12.0; // center-conductor jumpers
  const parts = [
    coaxBody(x0, x1, yHot),
    coaxBody(x0, x1, yUp),
    // Upper center conductor, jumpered onto the hot rail at both ends.
    line(xJ0, yUp, xJ1, yUp),
    line(xJ0, yHot, xJ0, yUp),
    line(xJ1, yHot, xJ1, yUp),
    dot(xJ0, yHot),
    dot(xJ1, yHot),
    // Braids bonded at both ends; the shields return via the pigtails.
    line(x0, yUp + r, x0, yHot - r),
    line(x1, yUp + r, x1, yHot - r),
    line(x0, yHot + r, x0, yRet),
    line(x1, yHot + r, x1, yRet),
  ];
  let y = yUp - r - 12.0 - 13.0 * (labelLines.length - 1);
  for (const s of labelLines) {
    parts.push(text((x0 + x1) / 2.0, y, s));
    y += 13.0;
  }
  return parts.join("");
}

// A coax run drawn per its construction: single cable, or a parallel pair for
// the catalog's "2x ... (parallel)" entries.
function unbalancedSection(
  x0: number,
  x1: number,
  yHot: number,
  yRet: number,
  labelLines: readonly string[],
  coax: JsonObject,
): string {
  if ((coax.name as string).includes("(parallel)")) {
    return parallelPairSection(x0, x1, yHot, yRet, labelLines);
  }
  return coaxSection(x0, x1, yHot, yRet, labelLines);
}

// Balanced pair: two coax side by side (one per conductor), a shield cylinder
// around each, braids bonded by a strap at both ends. The pair's shields
// float (no pigtails, no ground).
function balancedPairSection(
  x0: number,
  x1: number,
  yTop: number,
  labelLines: readonly string[],
): string {
  const r = COAX_RY;
  const parts: string[] = [];
  for (const y of [yTop, yTop + RAIL_GAP]) {
    parts.push(line(x0, y - r, x1, y - r) + line(x0, y + r, x1, y + r));
    parts.push(
      [x0, x1]
        .map(
          (x) =>
            `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pyFloat(r)}"/>`,
        )
        .join(""),
    );
  }
  // Braids soldered together at both ends.
  for (const x of [x0, x1]) {
    parts.push(line(x, yTop + r, x, yTop + RAIL_GAP - r));
  }
  let y = yTop - r - 12.0 - 13.0 * (labelLines.length - 1);
  for (const s of labelLines) {
    parts.push(text((x0 + x1) / 2.0, y, s));
    y += 13.0;
  }
  return parts.join("");
}

// Half-wave coax balun: a shielded hairpin (coax U) whose center-conductor
// ends are the balanced pair. Returns [svg, x where the outer shield wall
// crosses the return-rail height, for the feed line's braid bond].
function balunHairpin(x: number, yTop: number): [string, number] {
  const rC = RAIL_GAP / 2.0; // center conductor
  const rO = rC + COAX_RY; // shield, outer wall
  const rI = rC - COAX_RY; // shield, inner wall
  const yBot = yTop + RAIL_GAP;
  const body = `<path d="M${x.toFixed(1)},${yTop.toFixed(1)} A${pyFloat(rC)},${pyFloat(rC)} 0 0 0 ${x.toFixed(1)},${yBot.toFixed(1)}"/><path d="M${x.toFixed(1)},${(yTop - COAX_RY).toFixed(1)} A${pyFloat(rO)},${pyFloat(rO)} 0 0 0 ${x.toFixed(1)},${(yBot + COAX_RY).toFixed(1)}"/><path d="M${x.toFixed(1)},${(yTop + COAX_RY).toFixed(1)} A${pyFloat(rI)},${pyFloat(rI)} 0 0 0 ${x.toFixed(1)},${(yBot - COAX_RY).toFixed(1)}"/>${[
    yTop,
    yBot,
  ]
    .map(
      (y) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pyFloat(COAX_RY)}"/>`,
    )
    .join("")}${dot(x, yTop)}${dot(x, yBot)}`;
  const bondX = x - Math.sqrt(rO * rO - rC * rC);
  return [body, bondX];
}

// Vertical conductor that hops over a horizontal one at yCross.
function hop(x: number, yFrom: number, yCross: number, yTo: number): string {
  return (
    `<path d="M${x.toFixed(1)},${yFrom.toFixed(1)} V${(yCross - HOP_RADIUS).toFixed(1)} ` +
    `A${pyFloat(HOP_RADIUS)},${pyFloat(HOP_RADIUS)} 0 0 1 ${x.toFixed(1)},${(yCross + HOP_RADIUS).toFixed(1)} ` +
    `V${yTo.toFixed(1)}"/>`
  );
}

// Full-wave loop: a circle broken at the feed gap, fed from the pair.
function loopSymbol(xRails: number, yTop: number, cx: number, label: string): string {
  const cy = yTop + RAIL_GAP / 2.0;
  const gap = (LOOP_GAP_DEG * Math.PI) / 180.0;
  const ax = cx - LOOP_RADIUS * Math.cos(gap);
  const dy = LOOP_RADIUS * Math.sin(gap);
  return `${
    line(xRails, yTop, ax, cy - dy) + line(xRails, yTop + RAIL_GAP, ax, cy + dy)
  }<path d="M${ax.toFixed(1)},${(cy - dy).toFixed(1)} A${pyFloat(LOOP_RADIUS)},${pyFloat(LOOP_RADIUS)} 0 1 1 ${ax.toFixed(1)},${(cy + dy).toFixed(1)}"/>${text(cx, cy + 4.0, label)}`;
}

// Conductor swap (crossed phasing-line connection), no junction.
function crossover(x0: number, x1: number, yTop: number): string {
  const yBot = yTop + RAIL_GAP;
  return line(x0, yTop, x1, yBot) + line(x0, yBot, x1, yTop);
}

// Series match element in the hot conductor, or a plain wire.
function seriesElement(
  series: JsonObject | null,
  x0: number,
  x1: number,
  y: number,
): string {
  if (series === null) {
    return line(x0, y, x1, y);
  }
  let body: string;
  let designator: string;
  let value: string;
  if (series.kind === "capacitor") {
    body = capacitor(x0, x1, y);
    designator = "C1";
    value = `${(series.value_pf as number).toFixed(1)} pF`;
  } else {
    body = inductor(x0, x1, y);
    designator = "L1";
    value = `${(series.value_nh as number).toFixed(0)} nH`;
  }
  const mid = (x0 + x1) / 2.0;
  return body + text(mid, y - 37.0, designator) + text(mid, y - 24.0, value);
}

// Layout for the quarter-wave line feed; returns [body, width, height].
function linePhased(build: JsonObject): [string, number, number] {
  const match = obj(build.match);
  const phasing = obj(build.phasing_line);
  const crossed = phasing.connection === "crossed";

  const yA = 120.0; // hot rail of the main run and the loop A branch
  const yB = 230.0; // hot rail of the loop B branch
  const xTerm = 48.0;
  // The series element sits between the transformer and the junction (it
  // cancels the feedpoint reactance before the line transforms the rest).
  const xTl0 = 90.0;
  const xTl1 = 250.0;
  const xSer0 = 280.0;
  const xSer1 = 336.0;
  const xTeeA = 382.0;
  const xTeeB = 398.0; // junction tees onto the two rails
  const xRailEnd = 470.0; // loop A leads start here
  const loopACx = 530.0;
  const xPh0 = 440.0;
  const xPh1 = 600.0;
  const xSwap0 = 610.0;
  const xSwap = 634.0;
  const loopBCx = 696.0;

  const tlCoax = obj(match.transformer_coax);
  const tlLabel = [
    `TL1  ${tlCoax.name} (${formatG(tlCoax.z0_ohm as number)} &#8486;)`,
    `1/4 wave  ${(match.transformer_length_mm as number).toFixed(0)} mm`,
  ];
  const phCoax = obj(phasing.coax);
  const phLabel = [
    `TL2  ${phCoax.name} (${formatG(phCoax.z0_ohm as number)} &#8486;)`,
    `1/4 wave  ${(phasing.length_mm as number).toFixed(0)} mm`,
  ];

  const rig = `to rig (${formatG(match.system_z_ohm as number)} &#8486;)`;
  const parts = [
    text(xTerm - 24.0, yA + RAIL_GAP + 30.0, rig, "start"),
    terminalPair(xTerm, yA),
    // Hot rail (the center conductor): terminal, through the transformer
    // shield, series element, on to the loop A leads.
    line(xTerm + TERMINAL_RADIUS, yA, xSer0, yA),
    seriesElement(match.series_element as JsonObject | null, xSer0, xSer1, yA),
    line(xSer1, yA, xRailEnd, yA),
    // Return conductor stops at the shield pigtails; inside the coax run the
    // shield is the return path.
    line(xTerm + TERMINAL_RADIUS, yA + RAIL_GAP, xTl0, yA + RAIL_GAP),
    line(xTl1, yA + RAIL_GAP, xRailEnd, yA + RAIL_GAP),
    unbalancedSection(xTl0, xTl1, yA, yA + RAIL_GAP, tlLabel, tlCoax),
    // Junction: the phasing line tees off both conductors.
    dot(xTeeA, yA),
    dot(xTeeB, yA + RAIL_GAP),
    hop(xTeeA, yA, yA + RAIL_GAP, yB),
    line(xTeeB, yA + RAIL_GAP, xTeeB, yB + RAIL_GAP),
    loopSymbol(xRailEnd, yA, loopACx, "LOOP A"),
    // Loop B branch pair, through the phasing line.
    line(xTeeA, yB, xSwap0, yB),
    line(xTeeB, yB + RAIL_GAP, xPh0, yB + RAIL_GAP),
    line(xPh1, yB + RAIL_GAP, xSwap0, yB + RAIL_GAP),
    unbalancedSection(xPh0, xPh1, yB, yB + RAIL_GAP, phLabel, phCoax),
  ];
  if (crossed) {
    parts.push(crossover(xSwap0, xSwap, yB));
    parts.push(text((xSwap0 + xSwap) / 2.0, yB + RAIL_GAP + 24.0, "crossed"));
  } else {
    parts.push(line(xSwap0, yB, xSwap, yB));
    parts.push(line(xSwap0, yB + RAIL_GAP, xSwap, yB + RAIL_GAP));
  }
  parts.push(loopSymbol(xSwap, yB, loopBCx, "LOOP B"));
  return [parts.join(""), 790, 320];
}

function sectionLabel(
  designator: string,
  piece: JsonObject,
  fraction: string,
): [string, string] {
  const coax = obj(piece.coax);
  return [
    `${designator}  ${coax.name} (${formatG(coax.z0_ohm as number)} &#8486;)`,
    `${fraction} wave  ${(piece.length_mm as number).toFixed(0)} mm`,
  ];
}

// Layout for the turnstile harness.
//
// Rig -> quarter-wave transformer -> harness port -> a Q-section leg per
// loop, with the delay line in loop B's leg and the sense connection at
// loop B.
function turnstileLayout(build: JsonObject): [string, number, number] {
  const harness = obj(build.harness);
  const match = obj(build.match);
  const crossed = harness.connection === "crossed";

  const yA = 120.0; // hot rail of the main run and the loop A leg
  const yB = 230.0; // hot rail of the loop B leg
  const xTerm = 48.0;
  const xS0 = 96.0;
  const xS1 = 244.0; // transformer
  const xSer0 = 268.0;
  const xSer1 = 320.0; // series element, when fitted
  const xTeeA = 348.0;
  const xTeeB = 364.0; // harness port tees
  const xQa0 = 404.0;
  const xQa1 = 524.0; // loop A Q-section
  const xRailEnd = 560.0;
  const loopACx = 620.0;
  const xDl0 = 404.0;
  const xDl1 = 500.0; // delay line, loop B leg
  const xQb0 = 528.0;
  const xQb1 = 624.0; // loop B Q-section
  const xSwap0 = 634.0;
  const xSwap = 658.0;
  const loopBCx = 720.0;

  const topLabel = sectionLabel(
    "TL1",
    { coax: match.transformer_coax, length_mm: match.transformer_length_mm },
    "1/4",
  );
  const rig = `to rig (${formatG(match.system_z_ohm as number)} &#8486;, 1:1 choke)`;
  const series = match.series_element as JsonObject | null;

  const parts = [
    text(xTerm - 24.0, yA + RAIL_GAP + 30.0, rig, "start"),
    terminalPair(xTerm, yA),
    // Hot rail through the first section and series element to loop A.
    line(xTerm + TERMINAL_RADIUS, yA, xSer0, yA),
    seriesElement(series, xSer0, xSer1, yA),
    line(xSer1, yA, xRailEnd, yA),
    // Return rail, broken for each coax section's shield.
    line(xTerm + TERMINAL_RADIUS, yA + RAIL_GAP, xS0, yA + RAIL_GAP),
    line(xS1, yA + RAIL_GAP, xRailEnd, yA + RAIL_GAP),
    unbalancedSection(
      xS0,
      xS1,
      yA,
      yA + RAIL_GAP,
      topLabel,
      obj(match.transformer_coax),
    ),
    coaxSection(
      xQa0,
      xQa1,
      yA,
      yA + RAIL_GAP,
      sectionLabel("Q1", obj(harness.q_section), "1/4"),
    ),
    // Harness port: loop B's leg tees off both conductors.
    dot(xTeeA, yA),
    dot(xTeeB, yA + RAIL_GAP),
    hop(xTeeA, yA, yA + RAIL_GAP, yB),
    line(xTeeB, yA + RAIL_GAP, xTeeB, yB + RAIL_GAP),
    loopSymbol(xRailEnd, yA, loopACx, "LOOP A"),
    // Loop B leg: delay line then Q-section.
    line(xTeeA, yB, xSwap0, yB),
    line(xTeeB, yB + RAIL_GAP, xDl0, yB + RAIL_GAP),
    line(xDl1, yB + RAIL_GAP, xQb0, yB + RAIL_GAP),
    line(xQb1, yB + RAIL_GAP, xSwap0, yB + RAIL_GAP),
    coaxSection(
      xDl0,
      xDl1,
      yB,
      yB + RAIL_GAP,
      sectionLabel("DL1", obj(harness.delay_line), "1/4"),
    ),
    coaxSection(
      xQb0,
      xQb1,
      yB,
      yB + RAIL_GAP,
      sectionLabel("Q2", obj(harness.q_section), "1/4"),
    ),
  ];
  if (crossed) {
    parts.push(crossover(xSwap0, xSwap, yB));
    parts.push(text((xSwap0 + xSwap) / 2.0, yB + RAIL_GAP + 24.0, "crossed"));
  } else {
    parts.push(line(xSwap0, yB, xSwap, yB));
    parts.push(line(xSwap0, yB + RAIL_GAP, xSwap, yB + RAIL_GAP));
  }
  parts.push(loopSymbol(xSwap, yB, loopBCx, "LOOP B"));
  return [parts.join(""), 810, 320];
}

// Layout for the F5VIF balanced system (balun4).
//
// Rig coax arrives at one end of the half-wave balun hairpin (the feedline
// braid bonds to the hairpin's shield; nothing in the harness is grounded);
// the hairpin's open ends are the 200 ohm balanced pair, which runs through
// the balanced Q-section to the junction across loop A; the balanced phasing
// line reaches loop B.
function balun4Layout(build: JsonObject): [string, number, number] {
  const harness = obj(build.harness);
  const match = obj(build.match);
  const balun = obj(harness.balun);
  const crossed = harness.connection === "crossed";

  const yA = 120.0; // upper conductor of the balanced pair and the loop A run
  const yB = 230.0; // upper conductor of the loop B branch
  const xTerm = 40.0;
  const xBalun = 124.0; // hairpin open ends (the balanced pair starts here)
  const xQ0 = 180.0;
  const xQ1 = 320.0; // balanced Q-section
  const xTeeA = 382.0;
  const xTeeB = 398.0; // junction tees
  const xRailEnd = 470.0;
  const loopACx = 530.0;
  const xPh0 = 440.0;
  const xPh1 = 600.0; // balanced phasing line
  const xSwap0 = 610.0;
  const xSwap = 634.0;
  const loopBCx = 696.0;

  const rig = `to rig (${formatG(match.system_z_ohm as number)} &#8486;)`;
  const yBot = yA + RAIL_GAP;
  const balunCoax = obj(balun.coax);
  const balunLabel1 = `BL1  ${balunCoax.name} 4:1 balun`;
  const balunLabel2 = `1/2 wave  ${(balun.length_mm as number).toFixed(0)} mm`;
  const [hairpin, bondX] = balunHairpin(xBalun, yA);
  const parts = [
    terminalPair(xTerm, yA),
    // Feedline: center conductor to the hairpin's near end, braid bonded onto
    // the hairpin's shield (there is no ground in this harness).
    line(xTerm + TERMINAL_RADIUS, yA, xBalun, yA),
    line(xTerm + TERMINAL_RADIUS, yBot, bondX, yBot),
    dot(bondX, yBot),
    hairpin,
    text(xTerm - 20.0, yBot + 42.0, balunLabel1, "start"),
    text(xTerm - 20.0, yBot + 55.0, balunLabel2, "start"),
    text(xTerm - 20.0, yBot + 78.0, rig, "start"),
    // The balanced pair to the loop A junction.
    line(xBalun, yA, xRailEnd, yA),
    line(xBalun, yA + RAIL_GAP, xRailEnd, yA + RAIL_GAP),
    balancedPairSection(
      xQ0,
      xQ1,
      yA,
      sectionLabel("Q1", obj(harness.q_section), "1/4"),
    ),
    dot(xTeeA, yA),
    dot(xTeeB, yA + RAIL_GAP),
    hop(xTeeA, yA, yA + RAIL_GAP, yB),
    line(xTeeB, yA + RAIL_GAP, xTeeB, yB + RAIL_GAP),
    loopSymbol(xRailEnd, yA, loopACx, "LOOP A"),
    // Balanced phasing line to loop B.
    line(xTeeA, yB, xSwap0, yB),
    line(xTeeB, yB + RAIL_GAP, xSwap0, yB + RAIL_GAP),
    balancedPairSection(
      xPh0,
      xPh1,
      yB,
      sectionLabel("PL1", obj(harness.phasing_line), "1/4"),
    ),
  ];
  if (crossed) {
    parts.push(crossover(xSwap0, xSwap, yB));
    parts.push(text((xSwap0 + xSwap) / 2.0, yB + RAIL_GAP + 24.0, "crossed"));
  } else {
    parts.push(line(xSwap0, yB, xSwap, yB));
    parts.push(line(xSwap0, yB + RAIL_GAP, xSwap, yB + RAIL_GAP));
  }
  parts.push(loopSymbol(xSwap, yB, loopBCx, "LOOP B"));
  return [parts.join(""), 780, 330];
}

// Feed and match schematic for a tuned design, as an SVG string.
export function renderFeedSchematic(result: DesignResult): string {
  const build = obj(resultToDict(result).build);
  let body: string;
  let width: number;
  let height: number;
  if ("phasing_line" in build) {
    [body, width, height] = linePhased(build);
  } else if ("phasing_line" in obj(build.harness)) {
    [body, width, height] = balun4Layout(build);
  } else {
    [body, width, height] = turnstileLayout(build);
  }
  return (
    `<svg class="sch" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="Feed and match schematic">${body}</svg>`
  );
}
