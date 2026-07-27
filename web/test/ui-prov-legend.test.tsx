// @vitest-environment jsdom
// The provenance legend is always present (tag meaning must not depend on hover).
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App";
import { makeFakeEngine } from "./fakeEngine";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("provenance legend", () => {
  it("shows all four tag meanings", () => {
    const { container } = render(<App engine={makeFakeEngine()} />);
    const legend = container.querySelector(".prov-legend");
    expect(legend).not.toBeNull();
    const text = legend?.textContent ?? "";
    for (const tag of ["est", "user", "opt", "opt*"]) {
      expect(text).toContain(tag);
    }
    expect(text).toContain("tracks frequency");
  });
});
