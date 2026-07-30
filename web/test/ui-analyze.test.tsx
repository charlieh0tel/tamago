// @vitest-environment jsdom
// Analyze flow with a mocked engine: pressing Analyze renders the cut sheet and
// flags a non-opt perimeter as off-quadrature on the summary metric.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("analyze flow", () => {
  it("renders the cut sheet and an analyzed-not-tuned status", async () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    const analyze = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Analyze",
    );
    if (analyze === undefined) {
      throw new Error("analyze button missing");
    }
    expect(analyze.disabled).toBe(false);
    fireEvent.click(analyze);

    await waitFor(() => {
      expect(container.querySelector("pre.cut")?.textContent).toContain(
        "Eggbeater cut sheet: FAKE",
      );
    });
    // A non-opt (estimated) perimeter analyzes but is not quadrature-tuned,
    // which the summary's Quadrature metric flags (it carries the phase too).
    const quadrature = Array.from(container.querySelectorAll(".metric")).find((m) =>
      m.textContent?.includes("Quadrature"),
    );
    expect(quadrature?.className).toContain("warn");
  });

  it("switches to the report view from the cut sheet print action", async () => {
    const { container, getByText } = render(<App engine={makeFakeEngine()} />);
    const analyze = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Analyze",
    );
    fireEvent.click(analyze as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector("pre.cut")).not.toBeNull());

    fireEvent.click(getByText("print view"));
    // The report view lazily computes charts/sky; wait for it to settle.
    await waitFor(() => expect(container.querySelector(".report")).not.toBeNull());
    await waitFor(() => expect(container.querySelector("figure.chart")).not.toBeNull());
    expect(getByText("Cut sheet")).toBeInTheDocument();
  });
});
