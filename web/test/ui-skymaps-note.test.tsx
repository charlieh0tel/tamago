// @vitest-environment jsdom
// The sky maps carry an orientation note and accessible names, so the polar
// plots are not unlabeled circles.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkyMaps } from "../src/app/components/SkyMaps";
import type { SkyData } from "../src/app/engineExtras";

const data: SkyData = {
  gainMap: new Map([["0,0", 1.1]]),
  arMap: new Map([["0,0", 0.5]]),
  thetas: [0, 10],
  phis: [0, 15],
};

describe("sky map orientation", () => {
  it("shows an orientation note and names each plot", () => {
    const { container } = render(<SkyMaps state="ready" data={data} />);
    const note = container.querySelector(".polar-note");
    expect(note?.textContent).toContain("zenith");
    expect(note?.textContent).toContain("horizon");
    expect(note?.textContent).toContain("azimuth");

    const named = Array.from(container.querySelectorAll("svg[aria-label]"));
    expect(named.length).toBe(2);
    expect(named.some((s) => s.getAttribute("aria-label")?.includes("Gain"))).toBe(
      true,
    );
  });
});
