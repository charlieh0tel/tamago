// @vitest-environment jsdom
// Provenance tags flip correctly: est (live) -> user (touched) -> est
// (estimate) -> opt (optimized) -> opt* (stale after an edit).
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

function perimProv(container: HTMLElement): string {
  return container.querySelector(".prov")?.textContent ?? "";
}

describe("spec-rail provenance", () => {
  it("flips est -> user -> est and opt -> opt* across the lifecycle", async () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    // Default perimeter is the live closed-form estimate.
    expect(perimProv(container)).toBe("est");

    // Touching the field makes it user-owned.
    const perim = container.querySelector<HTMLInputElement>("#perim");
    if (perim === null) {
      throw new Error("perimeter input missing");
    }
    fireEvent.change(perim, { target: { value: "2100" } });
    expect(perimProv(container)).toBe("user");

    // The estimate button restores the live formula.
    const est = container.querySelector<HTMLButtonElement>('button[title*="estimate"]');
    if (est === null) {
      throw new Error("estimate button missing");
    }
    fireEvent.click(est);
    expect(perimProv(container)).toBe("est");

    // Optimize writes the perimeter back as an opt snapshot.
    const optimize = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Optimize",
    );
    if (optimize === undefined) {
      throw new Error("optimize button missing");
    }
    fireEvent.click(optimize);
    await waitFor(() => expect(perimProv(container)).toBe("opt"));

    // Any later edit stales all opt tags (opt*).
    const freq = container.querySelector<HTMLInputElement>("#freq");
    if (freq === null) {
      throw new Error("frequency input missing");
    }
    fireEvent.change(freq, { target: { value: "146.0" } });
    expect(perimProv(container)).toBe("opt*");
  });
});
