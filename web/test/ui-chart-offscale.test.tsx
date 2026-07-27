// @vitest-environment jsdom
// A VSWR curve that exceeds the chart ceiling (3) is flagged off-scale at each
// band edge, rather than reading as a flat line at the top.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Charts } from "../src/app/components/Charts";
import type { ChartData } from "../src/app/engineExtras";

const data: ChartData = {
  label: "2 m",
  f0: 145.9,
  z: { re: 45.8, im: 0.0 },
  sense: "RHCP",
  vswrPost: 1.1,
  arCone: 1.5,
  covGain: 1.1,
  vswrBand: [144, 148],
  arBand: [144, 148],
  // U-shaped: off scale (>3) at both edges, in band at centre.
  vswrFreq: [
    [-10, 5.0],
    [-5, 2.0],
    [0, 1.1],
    [5, 2.0],
    [10, 4.5],
  ],
  arFreq: [
    [-10, 5],
    [0, 1.5],
    [10, 5],
  ],
  arElev: [
    [0, 3],
    [90, 1.5],
  ],
  gainElev: [
    [0, -2],
    [90, 1.1],
  ],
};

describe("off-scale chart flags", () => {
  it("marks both edges of a clamped VSWR curve with the true value", () => {
    const { container } = render(<Charts state="ready" data={data} />);
    const flags = container.querySelectorAll(".offscale");
    // One flag per off-scale run: the two band edges.
    expect(flags).toHaveLength(2);
    const labels = Array.from(flags).map((g) => g.querySelector("text")?.textContent);
    expect(labels).toContain("5.0");
    expect(labels).toContain("4.5");
  });
});
