// @vitest-environment jsdom
// The Analyze/Optimize actions live in a pinned bar, and an analyzed-not-tuned
// result shows a hint pointing at Optimize.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("action bar", () => {
  it("groups the actions and hints at Optimize after a non-quadrature analyze", async () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    const actions = container.querySelector(".actions");
    expect(actions).not.toBeNull();
    expect(actions?.textContent).toContain("Analyze");
    expect(actions?.textContent).toContain("Optimize");

    // No hint before analyzing.
    expect(container.querySelector(".tune-hint")).toBeNull();

    const analyze = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Analyze",
    );
    fireEvent.click(analyze as HTMLButtonElement);

    // The fake engine analyzes to 84.1 deg (not quadrature) -> hint appears.
    await waitFor(() => expect(container.querySelector(".tune-hint")).not.toBeNull());
    expect(container.querySelector(".tune-hint")?.textContent).toContain("Optimize");
  });
});
