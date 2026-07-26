// @vitest-environment jsdom
// The corner-radius field appears only when the loop shape is squircle, and
// editing it patches spec.cornerRadiusWl.
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

function shapeButton(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
  if (btn === undefined) {
    throw new Error(`shape button ${label} missing`);
  }
  return btn as HTMLButtonElement;
}

describe("squircle corner radius", () => {
  it("shows the corner-radius field only for squircle", () => {
    const { container } = render(<App engine={makeFakeEngine()} />);

    // Default shape is circle: no corner-radius field.
    expect(container.querySelector("#corner")).toBeNull();

    fireEvent.click(shapeButton(container, "square"));
    expect(container.querySelector("#corner")).toBeNull();

    fireEvent.click(shapeButton(container, "squircle"));
    const corner = container.querySelector<HTMLInputElement>("#corner");
    expect(corner).not.toBeNull();
    // Seeded from the spec default corner radius.
    expect(Number(corner?.value)).toBeGreaterThan(0);

    // Editing it is reflected in the field.
    fireEvent.change(corner as HTMLInputElement, { target: { value: "0.08" } });
    expect(container.querySelector<HTMLInputElement>("#corner")?.value).toBe("0.08");

    // Leaving squircle removes the field again.
    fireEvent.click(shapeButton(container, "circle"));
    expect(container.querySelector("#corner")).toBeNull();
  });
});
