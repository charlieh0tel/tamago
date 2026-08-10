// Text reports: the physical cut sheet and the frequency-sweep bandwidths.
// Ported from the retired Python report.py. The output is byte-for-byte identical to the
// Python cut sheet (mind the printf-style format specs reproduced below).

import {
  AR_TARGET_DB,
  BORESIGHT_THETA_DEG,
  COVERAGE_THETA_DEG,
  NEC_SENSE_TO_HAND,
  VSWR_LIMIT,
} from "./constants";
import { type DesignResult, bandwidthWithin, frequencySweep } from "./design";
import { formatG } from "./format";
import type { NecRunner } from "./nec";
import { arFloorDb, resultToDict } from "./result";
import type { JsonObject } from "./spec";

// Above this, the drive imbalance is called out: it is then the dominant term in
// the axial ratio rather than a rounding detail.
const DRIVE_AR_FLOOR_WARN_DB = 1.0;
// The per-loop impedance the eggbeater literature states. Used only to show how
// far the axial-ratio conclusion moves if the modeled loop impedance is wrong;
// the evidence is discussed in docs/reference-designs.md.
const LITERATURE_LOOP_Z_OHM = 100.0;
// Fractional gap between a measured and the modeled loop impedance past which the
// two describe different antennas. A measurement corrects the drive split but
// cannot enter the NEC solve, so past this the modeled pattern figures are flagged
// as belonging to the model rather than to the antenna that was measured.
const MEASURED_LOOP_Z_DISAGREE_FRACTION = 0.1;
// Columns the cut sheet folds to. The widest row ran 108, which needs 813 px of
// monospace -- more than the results pane has ever had -- so the sheet used to
// need a horizontal scrollbar to read. 68 is what the pane holds at its
// narrowest, measured just above the 1180 px breakpoint where the rail is still
// two columns wide; below that the rail narrows and the pane has room to spare.
const CUT_SHEET_WIDTH = 68;

// Shape-appropriate label for the loop's across dimension (width_mm).
const WIDTH_TERM: Record<string, string> = {
  circle: "dia",
  square: "side",
  squircle: "width",
};

// --- printf-style formatting helpers (Python %f/%g equivalents). ---

// Python renders non-finite floats as inf/-inf/nan under every numeric format;
// JavaScript renders Infinity/-Infinity/NaN. An axial ratio is infinite dB
// wherever the pattern is exactly linear, so this reaches the cut sheet.
function nonFinite(x: number): string | null {
  if (Number.isNaN(x)) {
    return "nan";
  }
  if (x === Number.POSITIVE_INFINITY) {
    return "inf";
  }
  if (x === Number.NEGATIVE_INFINITY) {
    return "-inf";
  }
  return null;
}

// Python "%.<n>f".
function f(x: number, n: number): string {
  return nonFinite(x) ?? x.toFixed(n);
}

// Python "%+.<n>f": explicit sign, sign taken from the value (a negative that
// rounds to zero keeps its minus, matching Python).
function fs(x: number, n: number): string {
  if (!Number.isFinite(x)) {
    return Number.isNaN(x) ? "+nan" : x > 0 ? "+inf" : "-inf";
  }
  const sign = x < 0 || Object.is(x, -0) ? "-" : "+";
  return sign + Math.abs(x).toFixed(n);
}

// Python "%g" and "%.<p>g".
function g(x: number, precision = 6): string {
  return formatG(x, precision);
}

// Typed accessors for the result dict (values arrive as unknown).
function num(o: JsonObject, key: string): number {
  return o[key] as number;
}
function str(o: JsonObject, key: string): string {
  return o[key] as string;
}
function obj(o: JsonObject, key: string): JsonObject {
  return o[key] as JsonObject;
}

function formatSense(result: DesignResult): string {
  const achieved = NEC_SENSE_TO_HAND[result.sense];
  if (achieved === undefined) {
    return `${result.sense} (requested ${result.spec.sense})`;
  }
  if (achieved === result.spec.sense) {
    return achieved.toUpperCase();
  }
  return `${achieved.toUpperCase()} (requested ${result.spec.sense.toUpperCase()} not achieved)`;
}

function headerLines(result: DesignResult, build: JsonObject): string[] {
  const spec = result.spec;
  const title = spec.label
    ? `Eggbeater cut sheet: ${spec.label}`
    : "Eggbeater cut sheet";
  const lines = [
    title,
    "=".repeat(40),
    `Frequency            : ${g(num(build, "freq_mhz"), 4)} MHz`,
    `Wavelength           : ${f(num(build, "wavelength_mm"), 1)} mm`,
    `Conductor            : ${spec.conductor.description}`,
    `  equivalent radius  : ${g(spec.conductor.equivalentRadiusMm, 4)} mm`,
    `Loop shape           : ${str(build, "loop_shape")}`,
    `Reflector            : ${str(build, "reflector")}`,
  ];
  if ("corner_radius_mm" in build) {
    lines.push(`  corner radius      : ${f(num(build, "corner_radius_mm"), 1)} mm`);
  }
  if ("loop_center_height_mm" in build) {
    // Both heights, because they differ by most of a loop radius and only one of
    // them can be measured: the center is a point in mid air that moves as the
    // perimeter tunes, while the clearance is what a tape reaches.
    lines.push(
      `  loop center height : ${g(num(build, "loop_center_height_wl"), 3)} wl ` +
        `(${f(num(build, "loop_center_height_mm"), 1)} mm)`,
    );
    lines.push(
      `  bottom clearance   : ${g(num(build, "loop_bottom_clearance_wl"), 3)} wl (${f(num(build, "loop_bottom_clearance_mm"), 1)} mm), reflector to the lower loop`,
    );
  }
  if ("radials" in build) {
    const radials = obj(build, "radials");
    lines.push(
      `  radials            : ${num(radials, "count")} x ` +
        `${f(num(radials, "length_mm"), 1)} mm, ${g(num(radials, "droop_deg"))} deg droop`,
    );
  }
  return lines;
}

function coaxText(piece: JsonObject): string {
  const coax = obj(piece, "coax");
  return (
    `${f(num(piece, "length_mm"), 1)} mm (${str(coax, "name")}, ` +
    `${g(num(coax, "z0_ohm"))} ohm, 1/4 wave, VF ${g(num(coax, "vf"))})`
  );
}

// Where the loop current split, and so the axial ratio, comes from.
//
// The split follows from |Z_loop| / Z0 exactly, so when the loop impedance is
// only modeled the sensitivity is shown as well: the figure the eggbeater
// literature states is far enough away to change the conclusion, and a point-fed
// loop is not something NEC is reliable about.
function driveLines(drive: JsonObject): string[] {
  const z0 = num(drive, "phasing_z0_ohm");
  const loopZ = drive.loop_z_ohm as number | null;
  const source = drive.loop_z_source as string | null;
  const balance = num(drive, "balance");
  const floor = num(drive, "ar_floor_db");
  if (loopZ === null) {
    return [`  drive split        : ${g(z0)} ohm line, balance ${f(balance, 2)}`];
  }
  const lines = [
    `  drive split        : ${g(z0)} ohm line vs ${f(loopZ, 0)} ohm loop ` +
      `(${source}), balance ${f(balance, 2)}`,
  ];
  if (floor > DRIVE_AR_FLOOR_WARN_DB) {
    lines.push(
      `  ! ${f(floor, 1)} dB of axial ratio from that split alone; equal drive ` +
        `wants a ~${f(loopZ, 0)} ohm line`,
    );
  }
  if (source === "modeled") {
    const alt = arFloorDb(LITERATURE_LOOP_Z_OHM / z0);
    lines.push(
      `  ! loop Z modeled: at the literature's ${g(LITERATURE_LOOP_Z_OHM)} ohm ` +
        `it would be ${f(alt, 1)} dB (set measured_loop_z_ohm)`,
    );
  }
  const modeled = drive.modeled_loop_z_ohm as number | null;
  if (source === "measured" && modeled !== null) {
    const off = Math.abs(loopZ - modeled) / modeled;
    if (off > MEASURED_LOOP_Z_DISAGREE_FRACTION) {
      lines.push(
        `  ! measurement is ${f(off * 100, 0)}% off the modeled ${f(modeled, 0)} ohm; a reading cannot enter the NEC solve, so the predicted pattern below is still the modeled antenna's`,
      );
    }
  }
  return lines;
}

// The one build step that decides handedness: cross the phasing line at loop B,
// or do not. Stated as the action and what it gives you, since that is all the
// builder needs -- get it backwards and the antenna is the other sense.
function loopBConnectionLine(connection: string, sense: string): string {
  const action =
    connection === "crossed" ? "cross the two conductors" : "straight through";
  return `Loop B connection    : ${action}, gives ${sense}`;
}

// Achieved handedness as a bare token (RHCP/LHCP), for inline use.
function achievedSense(result: DesignResult): string {
  return (NEC_SENSE_TO_HAND[result.sense] ?? result.sense).toUpperCase();
}

function feedLines(build: JsonObject, sense: string): string[] {
  if ("phasing_line" in build) {
    const line = obj(build, "phasing_line");
    return [
      `Phasing line         : ${coaxText(line)}`,
      ...driveLines(obj(build, "drive")),
      loopBConnectionLine(str(line, "connection"), sense),
      "Feed                 : feedline to the junction across loop A",
    ];
  }
  const harness = obj(build, "harness");
  const balun = obj(harness, "balun");
  if ("q_section" in harness) {
    // The F5VIF balanced system (balun4): 4:1 half-wave balun + Q-section.
    return [
      `Phasing line         : ${coaxText(obj(harness, "phasing_line"))}`,
      ...driveLines(obj(build, "drive")),
      `Q-section            : ${coaxText(obj(harness, "q_section"))}`,
      "Pair braids          : bonded to each other at both ends; not grounded",
      `Balun                : ${str(balun, "kind")}, ${f(num(balun, "length_mm"), 1)} mm ${str(obj(balun, "coax"), "name")} (VF ${g(num(obj(balun, "coax"), "vf"))}); braid bonds to the feedline braid`,
      loopBConnectionLine(str(harness, "connection"), sense),
      "Feed                 : balun then Q-section to the junction across loop A",
    ];
  }
  // The F5VIF "final" balanced system (choke): 1:1 ferrite choke, no Q-section.
  const chokeCoax = str(obj(balun, "coax"), "name");
  return [
    `Phasing line         : ${coaxText(obj(harness, "phasing_line"))}`,
    ...driveLines(obj(build, "drive")),
    `Choke                : ${str(balun, "kind")}, ${num(balun, "cores")} x ${str(balun, "core_pn")} ferrite cores over ${chokeCoax} at the feedpoint`,
    "Pair braids          : bonded to each other at both ends; not grounded",
    loopBConnectionLine(str(harness, "connection"), sense),
    `Feed                 : ${chokeCoax} through the choke to the junction across loop A`,
  ];
}

// The NEC discretization, flagged when it sits outside its valid range.
function meshLines(mesh: JsonObject): string[] {
  const source = mesh.derived ? "derived" : "set";
  const radii = num(mesh, "segment_radii");
  const warn = num(mesh, "segment_radii_warn");
  const segWl = num(mesh, "segment_wl");
  const warnWl = num(mesh, "segment_wl_warn");
  const flags: string[] = [];
  if (radii < warn - 0.5) {
    flags.push(
      `thin-wire ratio ${f(radii, 0)} below ${f(warn, 0)}: loop impedance unreliable`,
    );
  }
  if (segWl > warnWl) {
    flags.push(
      `segments ${f(segWl, 3)} wl long, over ${g(warnWl)}: loop current under-resolved`,
    );
  }
  return [
    `NEC mesh             : ${num(mesh, "loop_segments")} sides/loop (${source}), ` +
      `${f(num(mesh, "segment_length_mm"), 1)} mm segments = ${f(segWl, 3)} wl = ` +
      `${f(radii, 0)} radii`,
    ...flags.map((flag) => `  ! ${flag}`),
  ];
}

function geometryLines(result: DesignResult, build: JsonObject): string[] {
  const term = WIDTH_TERM[str(build, "loop_shape")] ?? "width";
  const loop = obj(build, "loop");
  return [
    `Both loops           : ${f(num(loop, "perimeter_mm"), 1)} mm perimeter, ` +
      `${f(num(loop, "width_mm"), 1)} mm ${term}`,
    `Loop offset          : ${g(num(build, "loop_offset_mm"))} mm (loop A below, loop B above)`,
    `Feed gap             : ${g(num(build, "feed_gap_mm"))} mm at each loop bottom`,
    ...meshLines(obj(build, "mesh")),
    ...feedLines(build, achievedSense(result)),
  ];
}

function matchLines(result: DesignResult, build: JsonObject): string[] {
  const match = obj(build, "match");
  const lines = [`Match to ${g(num(match, "system_z_ohm"))} ohm:`];
  if (match.network === "harness") {
    lines.push("  via the harness Q-section and 4:1 balun (see above)");
    return lines;
  }
  if (match.network === "choke") {
    lines.push("  none; the 1:1 ferrite choke presents the feed Z directly");
    return lines;
  }
  if (match.network === "direct") {
    lines.push("  none needed; connect the feedline straight to the junction");
    return lines;
  }
  const series = match.series_element as JsonObject | null;
  if (series !== null) {
    const sized =
      str(series, "kind") === "capacitor"
        ? `${f(num(series, "value_pf"), 1)} pF`
        : `${f(num(series, "value_nh"), 0)} nH`;
    lines.push(
      `  series ${str(series, "kind").padEnd(9)}  : ${sized} to cancel ` +
        `${fs(result.zIn.im, 0)}j ohms`,
    );
  }
  const coax = obj(match, "transformer_coax");
  lines.push(
    `  1/4-wave Z0        : ${f(num(match, "transformer_z0_ohm"), 1)} ohms ` +
      `(use ${str(coax, "name")}, ${g(num(coax, "z0_ohm"))} ohm)`,
    `  1/4-wave length    : ${f(num(match, "transformer_length_mm"), 1)} mm ` +
      `(VF ${g(num(coax, "vf"))})`,
  );
  return lines;
}

function performanceLines(result: DesignResult, perf: JsonObject): string[] {
  const z = obj(perf, "feed_z_ohm");
  const lines = [
    "Predicted performance:",
    `  feedpoint Z        : ${f(num(z, "real"), 1)} ${fs(num(z, "imag"), 1)}j ohms`,
  ];
  const za = perf.loop_a_feed_z_ohm as JsonObject | null;
  const zb = perf.loop_b_feed_z_ohm as JsonObject | null;
  if (za !== null && zb !== null) {
    lines.push(
      `  loop A feed Z      : ${f(num(za, "real"), 1)} ${fs(num(za, "imag"), 1)}j ohms`,
    );
    lines.push(
      `  loop B feed Z      : ${f(num(zb, "real"), 1)} ${fs(num(zb, "imag"), 1)}j ohms`,
    );
  }
  lines.push(
    `  VSWR (unmatched)   : ${f(num(perf, "vswr_unmatched"), 2)}`,
    `  loop current phase : ${fs(num(perf, "loop_current_phase_deg"), 1)} deg (target +/-90)`,
    `  loop balance       : ${f(num(perf, "loop_balance"), 3)} |Ib/Ia| (1.0 = equal drive)`,
    `  polarization sense : ${formatSense(result)}`,
    `  axial ratio (cone) : ${f(num(perf, "axial_ratio_cone_db"), 2)} dB mean, ` +
      `${f(num(perf, "axial_ratio_cone_worst_db"), 2)} dB worst ` +
      `(<= ${Math.trunc(BORESIGHT_THETA_DEG)} deg from zenith)`,
    `  axial ratio (peak) : ${f(num(perf, "axial_ratio_peak_db"), 2)} dB`,
    `  coverage gain      : ${f(num(perf, "coverage_gain_dbi"), 2)} dBi ` +
      `(worst case <= ${Math.trunc(COVERAGE_THETA_DEG)} deg from zenith)`,
  );
  return lines;
}

function buildLines(result: DesignResult, build: JsonObject): string[] {
  const lines = headerLines(result, build);
  lines.push("-".repeat(40));
  lines.push(...geometryLines(result, build));
  lines.push("-".repeat(40));
  lines.push(...matchLines(result, build));
  return lines;
}

// Buildable cut list only: dimensions and the matching hardware.
export function cutSheetBuild(result: DesignResult): string {
  const build = obj(resultToDict(result), "build");
  return `${buildLines(result, build).join("\n")}\n`;
}

// Full cut sheet: the build cut list plus the predicted performance.
// Column a folded continuation of this line should start in. Rows are
// "label : value", so a continuation lines up under the value and the label
// column stays a column. Found from the first ": " rather than a fixed width,
// which also does the right thing for the indented sub-rows and, for a "! "
// warning, lines up under its text. Falls back to the line's own indent.
function valueColumn(line: string): number {
  const sep = line.indexOf(": ");
  if (sep !== -1) {
    return sep + 2;
  }
  const stripped = line.replace(/^ +/, "");
  const indent = line.length - stripped.length;
  return stripped.startsWith("! ") ? indent + 2 : indent;
}

// Pull a word down when a fold would leave one alone on the last line:
// "balance" and "0.98" on separate lines reads worse than a slightly shorter
// line above it does. Only ever moves one word, and only when the line above
// keeps something of its own.
function unwiden(folded: string[], indent: string): void {
  if (folded.length < 2) {
    return;
  }
  const last = (folded[folded.length - 1] as string).slice(indent.length);
  if (last.includes(" ")) {
    return;
  }
  const above = (folded[folded.length - 2] as string).split(" ");
  const tail = above[above.length - 1];
  if (above.length < 2 || !tail) {
    return;
  }
  folded[folded.length - 1] = `${indent}${tail} ${last}`;
  folded[folded.length - 2] = above.slice(0, -1).join(" ");
}

// Fold lines past the width onto continuations, breaking between words. Done to
// the assembled sheet rather than at each row, so every row is covered without
// each one having to remember to be. A single word longer than the space left
// for it still overflows -- there is nowhere to break it.
function fold(lines: string[], width: number = CUT_SHEET_WIDTH): string[] {
  const folded: string[] = [];
  for (const line of lines) {
    if (line.length <= width) {
      folded.push(line);
      continue;
    }
    const indent = " ".repeat(valueColumn(line));
    // The first line keeps the row's real prefix; only continuations get spaces.
    const head = line.slice(0, indent.length);
    const rest = line.slice(indent.length).split(" ");
    let current = head + rest[0];
    for (const word of rest.slice(1)) {
      if (current.length + 1 + word.length <= width) {
        current += ` ${word}`;
      } else {
        folded.push(current);
        current = indent + word;
      }
    }
    folded.push(current);
    unwiden(folded, indent);
  }
  return folded;
}

export function formatCutSheet(result: DesignResult): string {
  const data = resultToDict(result);
  const lines = buildLines(result, obj(data, "build"));
  lines.push("-".repeat(40));
  lines.push(...performanceLines(result, obj(data, "performance")));
  return `${fold(lines).join("\n")}\n`;
}

// One bandwidth line, or a not-met note when the band is empty.
function bandLine(
  label: string,
  band: [number, number] | null,
  center: number,
): string {
  if (band === null) {
    return `  ${label.padEnd(19)}: not met at the design frequency`;
  }
  const [low, high] = band;
  const width = high - low;
  return (
    `  ${label.padEnd(19)}: ${f(low, 2)} - ${f(high, 2)} MHz ` +
    `(${f(width, 2)} MHz, ${f((100 * width) / center, 1)} %)`
  );
}

// Run a frequency sweep and render the VSWR and axial-ratio bandwidths.
export async function formatBandwidth(
  result: DesignResult,
  runner: NecRunner,
): Promise<string> {
  const sweep = await frequencySweep(result, runner);
  const center = result.spec.freqMhz;
  const vswrBand = bandwidthWithin(
    sweep.map((p) => [p.freqMhz, p.vswr] as [number, number]),
    VSWR_LIMIT,
  );
  const arBand = bandwidthWithin(
    sweep.map((p) => [p.freqMhz, p.arDb] as [number, number]),
    AR_TARGET_DB,
  );
  const lines = [
    "-".repeat(40),
    `Frequency sweep (${sweep.length} points):`,
    bandLine(`${g(VSWR_LIMIT)}:1 VSWR`, vswrBand, center),
    bandLine(`${g(AR_TARGET_DB)} dB axial ratio`, arBand, center),
  ];
  return `${lines.join("\n")}\n`;
}
