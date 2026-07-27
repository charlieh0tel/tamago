// An analysis-affecting edit clears the optimization block so a shared or
// reopened edited design does not reappear as freshly optimized; a label edit
// preserves it.

import { describe, expect, it } from "vitest";
import { initialState, reducer } from "../src/app/state/reducer";
import { defaultSpec, provenanceForSpec } from "../src/app/state/uiSpec";
import type { DesignSpec, Optimization } from "../src/engine/index";

// The reducer and provenanceForSpec only test the block for presence.
const optimized: DesignSpec = {
  ...defaultSpec(),
  loopPerimeterMm: 2100,
  optimization: { input: defaultSpec() } as unknown as Optimization,
};

describe("optimization invalidation on edit", () => {
  it("starts with opt provenance for an optimized spec", () => {
    expect(provenanceForSpec(optimized).spacing).toBe("opt");
  });

  it("clears the optimization block on analysis-affecting edits", () => {
    const state = initialState(optimized);
    for (const action of [
      { type: "SET_FREQ", value: 200 } as const,
      { type: "PATCH_SPEC", patch: { loopShape: "square" } } as const,
      { type: "SET_REFLECTOR_FIELD", field: "spacing", value: 0.3 } as const,
    ]) {
      const next = reducer(state, action);
      expect(next.spec.optimization).toBeNull();
      // Reopening that serialized spec would not claim fresh opt.
      expect(provenanceForSpec(next.spec).spacing).not.toBe("opt");
    }
  });

  it("preserves the optimization block on a label edit", () => {
    const state = initialState(optimized);
    const next = reducer(state, { type: "SET_LABEL", value: "renamed" });
    expect(next.spec.optimization).not.toBeNull();
    expect(provenanceForSpec(next.spec).spacing).toBe("opt");
  });
});
