// @vitest-environment jsdom
// The report describes the analyzed snapshot, not the live editor. After an
// edit, it keeps the analyzed frequency/design-link and shows a prominent
// unapplied-edits warning.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

function clickText(container: HTMLElement, text: string): void {
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
  if (el === undefined) {
    throw new Error(`button "${text}" missing`);
  }
  fireEvent.click(el);
}

describe("report snapshot", () => {
  it("reports the analyzed design and warns about unapplied edits", async () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    clickText(container, "Analyze");
    await waitFor(() => expect(container.querySelector("pre.cut")).not.toBeNull());

    // Edit the frequency after analyzing.
    const freq = container.querySelector<HTMLInputElement>("#freq");
    fireEvent.change(freq as HTMLInputElement, { target: { value: "200" } });

    clickText(container, "print view");
    await waitFor(() => expect(container.querySelector(".report")).not.toBeNull());

    // The report shows the analyzed frequency (145.9), not the edited 200.
    const meta = container.querySelector(".rmeta")?.textContent ?? "";
    expect(meta).toContain("145.9 MHz");
    expect(meta).not.toContain("200 MHz");

    // And carries the prominent unapplied-edits warning.
    expect(container.querySelector(".report-warn")).not.toBeNull();
  });
});
