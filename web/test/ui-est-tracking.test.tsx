// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";
import { SpecRail } from "../src/app/components/SpecRail";
import { initialState, reducer } from "../src/app/state/reducer";

function Harness() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  return (
    <SpecRail
      state={state}
      dispatch={dispatch}
      onAnalyze={() => {}}
      onOptimize={() => {}}
      onCancelOptimize={() => {}}
    />
  );
}

describe("fresh-page provenance and EST tracking", () => {
  it("starts with est perimeter only; reflector fields untagged", () => {
    const s = initialState();
    expect(s.prov.perim).toBe("est");
    expect(s.prov.spacing).toBe("default");
    expect(s.prov.droop).toBe("default");
    expect(s.prov.count).toBe("default");
    expect(s.status).toBe("fresh");
  });
  it("est perimeter re-derives in the DOM when frequency changes", () => {
    render(<Harness />);
    const freq = screen.getByLabelText(/Frequency/i) as HTMLInputElement;
    const perim = screen.getByLabelText(/Loop perimeter/i) as HTMLInputElement;
    const before = perim.value;
    fireEvent.change(freq, { target: { value: "146.5" } });
    expect(perim.value).not.toBe(before);
  });
  it("default-tagged fields show no provenance tag until edited", () => {
    render(<Harness />);
    // Only the perimeter carries a tag on a fresh page.
    expect(screen.getAllByTitle(/closed-form estimate/)).toHaveLength(1);
    expect(screen.queryByTitle(/set by you/)).toBeNull();
  });
});
