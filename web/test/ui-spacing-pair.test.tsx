// @vitest-environment jsdom
// The reflector clearance is offered in two boxes, wavelengths and millimeters,
// as two views of one stored value. Editing either has to move the other, and
// neither box may present a length as though it were the wavelength (an earlier
// label read "lambda = 34 mm", which says the wavelength is 34 mm).
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

// The default spec is free space, which hides the spacing fields. The reflector
// control is a segmented group of buttons, not a select.
function withGroundReflector(container: HTMLElement): void {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "ground",
  );
  if (button === undefined) {
    throw new Error("no ground option in the reflector control");
  }
  fireEvent.click(button);
}

function boxes(container: HTMLElement): [HTMLInputElement, HTMLInputElement] {
  const wl = container.querySelector("#spacing") as HTMLInputElement;
  const mm = container.querySelector("#spacing-mm") as HTMLInputElement;
  if (wl === null || mm === null) {
    throw new Error("spacing fields are not rendered");
  }
  return [wl, mm];
}

describe("reflector clearance in two units", () => {
  it("moves the length box when the wavelength box is edited", () => {
    const { container } = render(<App engine={makeFakeEngine()} />);
    withGroundReflector(container);
    const [wl, mm] = boxes(container);
    const before = Number(mm.value);

    fireEvent.change(wl, { target: { value: String(Number(wl.value) + 0.05) } });

    const [, mmAfter] = boxes(container);
    // 0.05 wavelengths at 145.9 MHz is about 103 mm.
    expect(Number(mmAfter.value) - before).toBeGreaterThan(90);
    expect(Number(mmAfter.value) - before).toBeLessThan(115);
  });

  it("moves the wavelength box when the length box is edited", () => {
    const { container } = render(<App engine={makeFakeEngine()} />);
    withGroundReflector(container);
    const [wl, mm] = boxes(container);
    const before = Number(wl.value);

    fireEvent.change(mm, { target: { value: String(Number(mm.value) + 205.5) } });

    const [wlAfter] = boxes(container);
    // Half a wavelength of 2054.8 mm is 0.1 wl.
    expect(Number(wlAfter.value) - before).toBeCloseTo(0.1, 2);
  });

  it("marks each box with its own unit and never a length as the wavelength", () => {
    const { container } = render(<App engine={makeFakeEngine()} />);
    withGroundReflector(container);
    const row = container.querySelector(".unitpair");
    const units = Array.from(row?.querySelectorAll(".u") ?? []).map((u) =>
      u.textContent?.trim(),
    );
    expect(units).toEqual(["λ", "mm"]);
    expect(row?.querySelector(".eq")?.textContent?.trim()).toBe("=");
  });
});
