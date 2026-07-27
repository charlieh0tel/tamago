// @vitest-environment jsdom
// The analysis summary strip appears after Analyze and flags off-target metrics
// (the fake engine analyzes to a non-quadrature 84.1 deg phase).
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("analysis summary", () => {
  it("shows metrics with a warn cue for an off-target value", async () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    expect(container.querySelector(".summary")).toBeNull();

    const analyze = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Analyze",
    );
    fireEvent.click(analyze as HTMLButtonElement);

    await waitFor(() => expect(container.querySelector(".summary")).not.toBeNull());

    const summary = container.querySelector(".summary") as HTMLElement;
    expect(summary.textContent).toContain("Quadrature");
    expect(summary.textContent).toContain("VSWR");
    // 84.1 deg is not quadrature, so at least the quadrature metric warns.
    expect(summary.querySelector(".metric.warn")).not.toBeNull();
  });
});
