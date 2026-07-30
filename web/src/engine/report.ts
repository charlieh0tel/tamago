// Text reports: the physical cut sheet and the frequency-sweep bandwidths.
// Port of src/awadateki/report.py. The output is byte-for-byte identical to the
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
import { resultToDict } from "./result";
import type { JsonObject } from "./spec";

// Shape-appropriate label for the loop's across dimension (width_mm).
const WIDTH_TERM: Record<string, string> = {
  circle: "dia",
  square: "side",
  squircle: "width",
};

// --- printf-style formatting helpers (Python %f/%g equivalents). ---

// Python "%.<n>f".
function f(x: number, n: number): string {
  return x.toFixed(n);
}

// Python "%+.<n>f": explicit sign, sign taken from the value (a negative that
// rounds to zero keeps its minus, matching Python).
function fs(x: number, n: number): string {
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
    `Frequency           : ${g(num(build, "freq_mhz"), 4)} MHz`,
    `Wavelength          : ${f(num(build, "wavelength_mm"), 1)} mm`,
    `Conductor           : ${spec.conductor.description}`,
    `  equivalent radius : ${g(spec.conductor.equivalentRadiusMm, 4)} mm`,
    `Loop shape          : ${str(build, "loop_shape")}`,
    `Reflector           : ${str(build, "reflector")}`,
  ];
  if ("corner_radius_mm" in build) {
    lines.push(`  corner radius     : ${f(num(build, "corner_radius_mm"), 1)} mm`);
  }
  if ("loop_center_height_mm" in build) {
    lines.push(
      `  loop-to-reflector : ${g(num(build, "loop_center_height_wl"), 3)} wl ` +
        `(${f(num(build, "loop_center_height_mm"), 1)} mm)`,
    );
  }
  if ("radials" in build) {
    const radials = obj(build, "radials");
    lines.push(
      `  radials           : ${num(radials, "count")} x ` +
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

function feedLines(build: JsonObject): string[] {
  if ("phasing_line" in build) {
    const line = obj(build, "phasing_line");
    return [
      `Phasing line        : ${coaxText(line)}`,
      `Feed                : feedline (via match) to junction across loop A; ${str(line, "connection")} line to loop B`,
    ];
  }
  const harness = obj(build, "harness");
  const balun = obj(harness, "balun");
  if ("q_section" in harness) {
    // The F5VIF balanced system (balun4): 4:1 half-wave balun + Q-section.
    return [
      `Phasing line        : ${coaxText(obj(harness, "phasing_line"))}`,
      `Q-section           : ${coaxText(obj(harness, "q_section"))}`,
      "Pair braids         : bonded to each other at both ends; not grounded",
      `Balun               : ${str(balun, "kind")}, ${f(num(balun, "length_mm"), 1)} mm ${str(obj(balun, "coax"), "name")} (VF ${g(num(obj(balun, "coax"), "vf"))}); braid bonds to the feedline braid`,
      `Feed                : balun then Q-section to the junction across loop A; ${str(harness, "connection")} phasing line to loop B`,
    ];
  }
  // The F5VIF "final" balanced system (choke): 1:1 ferrite choke, no Q-section.
  const chokeCoax = str(obj(balun, "coax"), "name");
  return [
    `Phasing line        : ${coaxText(obj(harness, "phasing_line"))}`,
    `Choke               : ${str(balun, "kind")}, ${num(balun, "cores")} x ${str(balun, "core_pn")} ferrite cores over ${chokeCoax} at the feedpoint`,
    "Pair braids         : bonded to each other at both ends; not grounded",
    `Feed                : ${chokeCoax} through the choke to the junction across loop A; ${str(harness, "connection")} phasing line to loop B`,
  ];
}

// The NEC discretization, flagged when it sits outside its valid range.
function meshLines(mesh: JsonObject): string[] {
  const source = mesh.derived ? "derived" : "set";
  const radii = num(mesh, "segment_radii");
  const target = num(mesh, "segment_radii_target");
  const segWl = num(mesh, "segment_wl");
  const warnWl = num(mesh, "segment_wl_warn");
  const flags: string[] = [];
  if (radii < target) {
    flags.push(
      `thin-wire ratio ${f(radii, 0)} below ${f(target, 0)}: loop impedance overstated`,
    );
  }
  if (segWl > warnWl) {
    flags.push(
      `segments ${f(segWl, 3)} wl long, over ${g(warnWl)}: loop current under-resolved`,
    );
  }
  return [
    `NEC mesh            : ${num(mesh, "loop_segments")} sides/loop (${source}), ` +
      `${f(num(mesh, "segment_length_mm"), 1)} mm segments = ${f(segWl, 3)} wl = ` +
      `${f(radii, 0)} radii`,
    ...flags.map((flag) => `  ! ${flag}`),
  ];
}

function geometryLines(build: JsonObject): string[] {
  const term = WIDTH_TERM[str(build, "loop_shape")] ?? "width";
  const loop = obj(build, "loop");
  return [
    `Both loops          : ${f(num(loop, "perimeter_mm"), 1)} mm perimeter, ` +
      `${f(num(loop, "width_mm"), 1)} mm ${term}`,
    `Loop offset         : ${g(num(build, "loop_offset_mm"))} mm (loop A below, loop B above)`,
    `Feed gap            : ${g(num(build, "feed_gap_mm"))} mm at each loop bottom`,
    ...meshLines(obj(build, "mesh")),
    ...feedLines(build),
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
    `  1/4-wave Z0       : ${f(num(match, "transformer_z0_ohm"), 1)} ohms ` +
      `(use ${str(coax, "name")}, ${g(num(coax, "z0_ohm"))} ohm)`,
    `  1/4-wave length   : ${f(num(match, "transformer_length_mm"), 1)} mm ` +
      `(VF ${g(num(coax, "vf"))})`,
  );
  return lines;
}

function performanceLines(result: DesignResult, perf: JsonObject): string[] {
  const z = obj(perf, "feed_z_ohm");
  const lines = [
    "Predicted performance:",
    `  feedpoint Z       : ${f(num(z, "real"), 1)} ${fs(num(z, "imag"), 1)}j ohms`,
  ];
  const za = perf.loop_a_feed_z_ohm as JsonObject | null;
  const zb = perf.loop_b_feed_z_ohm as JsonObject | null;
  if (za !== null && zb !== null) {
    lines.push(
      `  loop A feed Z     : ${f(num(za, "real"), 1)} ${fs(num(za, "imag"), 1)}j ohms`,
    );
    lines.push(
      `  loop B feed Z     : ${f(num(zb, "real"), 1)} ${fs(num(zb, "imag"), 1)}j ohms`,
    );
  }
  lines.push(
    `  VSWR (unmatched)  : ${f(num(perf, "vswr_unmatched"), 2)}`,
    `  loop current phase: ${fs(num(perf, "loop_current_phase_deg"), 1)} deg (target +/-90)`,
    `  loop balance      : ${f(num(perf, "loop_balance"), 3)} |Ib/Ia| (1.0 = equal drive)`,
    `  polarization sense: ${formatSense(result)}`,
    `  axial ratio (cone): ${f(num(perf, "axial_ratio_cone_db"), 2)} dB mean, ` +
      `${f(num(perf, "axial_ratio_cone_worst_db"), 2)} dB worst ` +
      `(<= ${Math.trunc(BORESIGHT_THETA_DEG)} deg from zenith)`,
    `  axial ratio (peak): ${f(num(perf, "axial_ratio_peak_db"), 2)} dB`,
    `  coverage gain     : ${f(num(perf, "coverage_gain_dbi"), 2)} dBi ` +
      `(worst case <= ${Math.trunc(COVERAGE_THETA_DEG)} deg from zenith)`,
  );
  return lines;
}

function buildLines(result: DesignResult, build: JsonObject): string[] {
  const lines = headerLines(result, build);
  lines.push("-".repeat(40));
  lines.push(...geometryLines(build));
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
export function formatCutSheet(result: DesignResult): string {
  const data = resultToDict(result);
  const lines = buildLines(result, obj(data, "build"));
  lines.push("-".repeat(40));
  lines.push(...performanceLines(result, obj(data, "performance")));
  return `${lines.join("\n")}\n`;
}

// One bandwidth line, or a not-met note when the band is empty.
function bandLine(
  label: string,
  band: [number, number] | null,
  center: number,
): string {
  if (band === null) {
    return `  ${label.padEnd(18)}: not met at the design frequency`;
  }
  const [low, high] = band;
  const width = high - low;
  return (
    `  ${label.padEnd(18)}: ${f(low, 2)} - ${f(high, 2)} MHz ` +
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
