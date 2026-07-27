// @vitest-environment jsdom
// A malformed #spec= link shows a bad-link banner and starts from the default
// design rather than silently loading the user's saved (localStorage) design.
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { defaultSpec } from "../src/app/state/uiSpec";
import { specToDict } from "../src/engine/index";
import { makeFakeEngine } from "./fakeEngine";

// A complete, valid saved spec at 435 MHz (specFromDict rejects partial dicts).
function saveSpec(freqMhz: number, label: string): void {
  const dict = { ...specToDict(defaultSpec()), freq_mhz: freqMhz, label };
  localStorage.setItem("tamago:last-spec", JSON.stringify(dict));
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("malformed share link", () => {
  it("warns and does not load the saved design", () => {
    // A saved design that must NOT surface under a broken link.
    saveSpec(435, "SAVED-70CM");
    window.location.hash = "#spec=!!!not-base64!!!";

    const { container } = render(<App engine={makeFakeEngine()} />);

    // Bad-link banner is shown.
    expect(container.querySelector(".link-banner")).not.toBeNull();
    // The default design (145.9 MHz), not the saved 435 MHz one, is loaded.
    const freq = container.querySelector<HTMLInputElement>("#freq");
    expect(freq?.value).toBe("145.9");
    expect(container.textContent).not.toContain("SAVED-70CM");

    // The banner dismisses.
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "dismiss",
      ) as HTMLButtonElement,
    );
    expect(container.querySelector(".link-banner")).toBeNull();
  });

  it("still loads the saved design when there is no link at all", () => {
    saveSpec(435, "SAVED-70CM");
    const { container } = render(<App engine={makeFakeEngine()} />);
    expect(container.querySelector(".link-banner")).toBeNull();
    const freq = container.querySelector<HTMLInputElement>("#freq");
    expect(freq?.value).toBe("435");
  });
});
