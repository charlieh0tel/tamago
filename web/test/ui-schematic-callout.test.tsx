// @vitest-environment jsdom
// The Loop-B connection callout is prominent and explicit when crossed
// (a wrong swap flips the polarization) and quiet when normal.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Schematic } from "../src/app/components/Schematic";
import { defaultSpec } from "../src/app/state/uiSpec";
import { fakeResult } from "./fakeEngine";

const base = fakeResult(defaultSpec());

describe("loop-B connection callout", () => {
  it("warns and says to swap conductors when crossed", () => {
    const { container } = render(
      <Schematic result={{ ...base, crossedPhasingLine: true }} />,
    );
    const callout = container.querySelector(".conn-callout");
    expect(callout).not.toBeNull();
    expect(callout?.classList.contains("crossed")).toBe(true);
    expect(callout?.textContent).toContain("CROSSED");
    expect(callout?.textContent).toContain("Swap");
  });

  it("is quiet and says straight-through when normal", () => {
    const { container } = render(
      <Schematic result={{ ...base, crossedPhasingLine: false }} />,
    );
    const callout = container.querySelector(".conn-callout");
    expect(callout?.classList.contains("crossed")).toBe(false);
    expect(callout?.textContent).toContain("straight through");
  });
});
