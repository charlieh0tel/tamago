// The analysis fingerprint identifies the spec that produced a result. Editing
// analysis-affecting fields changes it; editing label/notes/optimization does
// not, so those edits must not stale a result.

import { describe, expect, it } from "vitest";
import { analysisFingerprint } from "../src/app/hash";
import { resultsStale } from "../src/app/state/reducer";
import { defaultSpec } from "../src/app/state/uiSpec";
import type { AnalysisBundle } from "../src/app/worker/protocol";

const bundle = {} as AnalysisBundle; // resultsStale only checks it is non-null.

describe("analysisFingerprint", () => {
  it("is stable and ignores label/notes/optimization", () => {
    const base = defaultSpec();
    const fp = analysisFingerprint(base);
    expect(analysisFingerprint(base)).toBe(fp);
    expect(analysisFingerprint({ ...base, label: "renamed" })).toBe(fp);
    expect(analysisFingerprint({ ...base, notes: "a note" })).toBe(fp);
  });

  it("changes when an analysis-affecting field changes", () => {
    const base = defaultSpec();
    const fp = analysisFingerprint(base);
    expect(analysisFingerprint({ ...base, freqMhz: base.freqMhz + 1 })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, systemZOhm: 75 })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, reflectorSpacingWl: 0.3 })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, loopShape: "square" })).not.toBe(fp);
  });
});

describe("resultsStale", () => {
  it("is false right after analysis and after a label edit; true after a real edit", () => {
    const spec = defaultSpec();
    const analyzedFingerprint = analysisFingerprint(spec);

    expect(resultsStale({ analysis: bundle, analyzedFingerprint, spec })).toBe(false);
    expect(
      resultsStale({
        analysis: bundle,
        analyzedFingerprint,
        spec: { ...spec, label: "renamed" },
      }),
    ).toBe(false);
    expect(
      resultsStale({
        analysis: bundle,
        analyzedFingerprint,
        spec: { ...spec, freqMhz: spec.freqMhz + 5 },
      }),
    ).toBe(true);
  });

  it("is false when nothing has been analyzed", () => {
    const spec = defaultSpec();
    expect(resultsStale({ analysis: null, analyzedFingerprint: null, spec })).toBe(
      false,
    );
  });
});
