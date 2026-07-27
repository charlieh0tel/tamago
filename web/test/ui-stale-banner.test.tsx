// @vitest-environment jsdom
// After analyzing, an analysis-affecting edit shows the stale-results banner
// over the results pane; a label-only edit does not.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

function analyzeButton(container: HTMLElement): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Analyze",
  );
  if (btn === undefined) {
    throw new Error("analyze button missing");
  }
  return btn as HTMLButtonElement;
}

describe("stale-results banner", () => {
  it("appears after a real edit and not after a label edit", async () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    fireEvent.click(analyzeButton(container));
    await waitFor(() => expect(container.querySelector("pre.cut")).not.toBeNull());

    // Fresh analysis: no banner.
    expect(container.querySelector(".stale-banner")).toBeNull();

    // Renaming the design must not stale the result.
    const label = container.querySelector<HTMLInputElement>("#label");
    fireEvent.change(label as HTMLInputElement, { target: { value: "my rig" } });
    expect(container.querySelector(".stale-banner")).toBeNull();

    // Changing the frequency does.
    const freq = container.querySelector<HTMLInputElement>("#freq");
    fireEvent.change(freq as HTMLInputElement, { target: { value: "146.5" } });
    expect(container.querySelector(".stale-banner")).not.toBeNull();

    // Re-analyzing clears it.
    fireEvent.click(analyzeButton(container));
    await waitFor(() => expect(container.querySelector(".stale-banner")).toBeNull());
  });
});
