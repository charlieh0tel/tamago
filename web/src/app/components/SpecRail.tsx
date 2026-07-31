// Left rail: the spec editor in collapsible groups (Basics, Feed, Reflector,
// Advanced) plus the Analyze / Optimize actions and the optimizer progress
// panel. Every solver-writable field carries a provenance tag; the form is the
// design (docs/web-ux.md).

import type { Dispatch } from "react";
import {
  KIND_BAR,
  KIND_ROUND,
  KIND_STRIP,
  LOOP_SHAPES,
  REFLECTOR_GROUND,
  REFLECTOR_NONE,
  REFLECTOR_RADIALS,
  SENSE_LHCP,
  SENSE_RHCP,
  SHAPE_SQUIRCLE,
  loopSegments,
} from "../../engine/index";
import type { Action, ProvField, ProvenanceMap, UiState } from "../state/types";
import {
  buildConductor,
  clearanceMmForSpec,
  clearanceWlForSpec,
  spacingWlForClearance,
  spacingWlForClearanceMm,
} from "../state/uiSpec";
import { optFraction } from "../worker/progressScale";
import { FeedCards } from "./FeedCards";

// -- provenance tag --
function ProvTag({
  field,
  prov,
  optStale,
}: {
  field: ProvField;
  prov: ProvenanceMap;
  optStale: boolean;
}): JSX.Element | null {
  const v = prov[field];
  if (v === "default") {
    return null;
  }
  const stale = v === "opt" && optStale;
  const title = stale
    ? "optimizer value, but inputs changed since that run"
    : v === "opt"
      ? "chosen by the optimizer"
      : v === "est"
        ? "closed-form estimate (tracks inputs)"
        : "set by you";
  return (
    <span className="prov" data-v={v} data-stale={stale ? "1" : "0"} title={title}>
      {v}
      {stale ? "*" : ""}
    </span>
  );
}

// Always-visible key for the field tags (their meaning is otherwise only in a
// hover title, which is invisible on touch). Renders the real .prov styles.
const LEGEND: Array<{ v: string; stale?: boolean; text: string; label: string }> = [
  { v: "est", text: "est", label: "estimate, tracks frequency" },
  { v: "user", text: "user", label: "entered by you" },
  { v: "opt", text: "opt", label: "from optimizer" },
  { v: "opt", stale: true, text: "opt*", label: "stale, re-run" },
];

function ProvLegend(): JSX.Element {
  return (
    <div className="prov-legend">
      {LEGEND.map((e) => (
        <span className="prov-legend-item" key={e.text}>
          <span className="prov" data-v={e.v} data-stale={e.stale ? "1" : "0"}>
            {e.text}
          </span>
          {e.label}
        </span>
      ))}
    </div>
  );
}

// -- segmented control --
function Seg({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="seg" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={opt === value ? "on" : ""}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function num(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function SpecRail({
  state,
  dispatch,
  onAnalyze,
  onOptimize,
  onCancelOptimize,
}: {
  state: UiState;
  dispatch: Dispatch<Action>;
  onAnalyze: () => void;
  onOptimize: () => void;
  onCancelOptimize: () => void;
}): JSX.Element {
  const { spec, prov, optStale, status } = state;
  const flash = (id: string): string =>
    state.flashFields.includes(id) ? " flash" : "";
  // The spacing field is authored as the measurable clearance under the lower
  // loop, not the stored loop-center height (see clearanceWlForSpec).
  const clearanceWl = clearanceWlForSpec(spec, state.perimeterMm);
  const clearanceMm = clearanceMmForSpec(spec, state.perimeterMm);
  const conductor = spec.conductor;
  const kind = conductor.kind;
  const dims = conductor.dimensionsMm;

  const setConductor = (k: string, d: number[]): void => {
    dispatch({
      type: "SET_CONDUCTOR",
      spec: { ...spec, conductor: buildConductor(k as typeof kind, d) },
    });
  };

  const busy = status === "analyzing" || status === "optimizing";
  const analyzeEnabled = !busy && status !== "analyzed" && status !== "tuned";
  const analyzeNote =
    status === "edited"
      ? "press Analyze (~1 s)"
      : status === "analyzed" || status === "tuned"
        ? "analysis is current"
        : "one nec2c evaluation of the spec as-is · ~1 s";

  return (
    <div className="rail">
      <ProvLegend />
      {/* Two columns: the form is otherwise a single stack tall enough to
          scroll on a laptop. Each group keeps its own single-column fields,
          so only the groups move. Collapses back to one column with the
          panes (see the .panes media query). */}
      <div className="railgrid">
        <div className="railcol">
          <details className="group g-basics" open>
            <summary>Basics</summary>
            <div className="gbody">
              <div className="inline">
                <div className="field">
                  <label htmlFor="freq">
                    Frequency <span className="unit">MHz</span>
                  </label>
                  <input
                    id="freq"
                    type="number"
                    step="0.1"
                    value={spec.freqMhz}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_FREQ",
                        value: num(e.target.value, spec.freqMhz),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="label">Label</label>
                  <input
                    id="label"
                    type="text"
                    value={spec.label ?? ""}
                    onChange={(e) =>
                      dispatch({ type: "SET_LABEL", value: e.target.value })
                    }
                  />
                </div>
              </div>

              <Seg
                label="Conductor"
                options={[KIND_ROUND, KIND_STRIP, KIND_BAR]}
                value={kind}
                onChange={(k) => {
                  const d =
                    k === KIND_BAR ? [dims[0] ?? 5, dims[1] ?? 2] : [dims[0] ?? 5];
                  setConductor(k, d);
                }}
              />
              <div className="inline">
                <div className="field">
                  <label htmlFor="dim0">
                    {kind === KIND_ROUND ? "Diameter" : "Width"}{" "}
                    <span className="unit">mm</span>
                  </label>
                  <input
                    id="dim0"
                    type="number"
                    step="0.5"
                    value={dims[0] ?? 0}
                    onChange={(e) =>
                      setConductor(kind, [
                        num(e.target.value, dims[0] ?? 1),
                        ...(kind === KIND_BAR ? [dims[1] ?? 1] : []),
                      ])
                    }
                  />
                </div>
                {kind === KIND_BAR && (
                  <div className="field">
                    <label htmlFor="dim1">
                      Thickness <span className="unit">mm</span>
                    </label>
                    <input
                      id="dim1"
                      type="number"
                      step="0.5"
                      value={dims[1] ?? 0}
                      onChange={(e) =>
                        setConductor(kind, [
                          dims[0] ?? 1,
                          num(e.target.value, dims[1] ?? 1),
                        ])
                      }
                    />
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="perim">
                  Loop perimeter <span className="unit">mm</span>
                  <ProvTag field="perim" prov={prov} optStale={optStale} />
                </label>
                <div className="inline" style={{ alignItems: "stretch" }}>
                  <input
                    id="perim"
                    className={flash("perim").trim()}
                    type="number"
                    step="0.5"
                    style={{ flex: 1 }}
                    value={Number(state.perimeterMm.toFixed(1))}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_PERIMETER",
                        value: num(e.target.value, state.perimeterMm),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="mini"
                    style={{ whiteSpace: "nowrap" }}
                    title="closed-form full-wave estimate"
                    onClick={() => dispatch({ type: "ESTIMATE_PERIMETER" })}
                  >
                    &#8634; estimate
                  </button>
                </div>
              </div>

              <Seg
                label="Loop shape"
                options={LOOP_SHAPES}
                value={spec.loopShape}
                onChange={(v) =>
                  dispatch({ type: "PATCH_SPEC", patch: { loopShape: v } })
                }
              />
              {spec.loopShape === SHAPE_SQUIRCLE && (
                <div className="field">
                  <label htmlFor="corner">
                    Corner radius <span className="unit">&lambda;</span>
                  </label>
                  <input
                    id="corner"
                    type="number"
                    step="0.005"
                    min="0"
                    value={spec.cornerRadiusWl}
                    onChange={(e) =>
                      dispatch({
                        type: "PATCH_SPEC",
                        patch: {
                          cornerRadiusWl: num(e.target.value, spec.cornerRadiusWl),
                        },
                      })
                    }
                  />
                </div>
              )}
              <Seg
                label="Polarization sense"
                options={[SENSE_RHCP, SENSE_LHCP]}
                value={spec.sense}
                onChange={(v) => dispatch({ type: "PATCH_SPEC", patch: { sense: v } })}
              />
            </div>
          </details>

          <details className="group g-advanced">
            <summary>Advanced</summary>
            <div className="gbody">
              <div className="inline">
                <div className="field">
                  <label>
                    Loop offset <span className="unit">mm</span>
                  </label>
                  <input
                    type="number"
                    value={spec.loopOffsetMm}
                    onChange={(e) =>
                      dispatch({
                        type: "PATCH_SPEC",
                        patch: { loopOffsetMm: num(e.target.value, spec.loopOffsetMm) },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>
                    Feed gap <span className="unit">mm</span>
                  </label>
                  <input
                    type="number"
                    value={spec.feedGapMm}
                    onChange={(e) =>
                      dispatch({
                        type: "PATCH_SPEC",
                        patch: { feedGapMm: num(e.target.value, spec.feedGapMm) },
                      })
                    }
                  />
                </div>
              </div>
              <div className="inline">
                <div className="field">
                  <label>
                    Segments
                    {spec.segments === null && <span className="unit">derived</span>}
                  </label>
                  <input
                    type="number"
                    title="polygon sides per loop; blank derives a count that holds the segment length at a fixed number of conductor radii, which is what keeps bands comparable"
                    value={spec.segments ?? loopSegments(spec)}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      dispatch({
                        type: "PATCH_SPEC",
                        patch: {
                          segments:
                            raw === ""
                              ? null
                              : Math.round(num(raw, loopSegments(spec))),
                        },
                      });
                    }}
                  />
                </div>
                <div className="field">
                  <label>
                    System Z <span className="unit">Ω</span>
                  </label>
                  <select
                    value={spec.systemZOhm}
                    onChange={(e) =>
                      dispatch({
                        type: "PATCH_SPEC",
                        patch: { systemZOhm: num(e.target.value, spec.systemZOhm) },
                      })
                    }
                  >
                    <option value={50}>50</option>
                    <option value={75}>75</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>
                  AR margin <span className="unit">dB</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={spec.arMarginDb}
                  onChange={(e) =>
                    dispatch({
                      type: "PATCH_SPEC",
                      patch: { arMarginDb: num(e.target.value, spec.arMarginDb) },
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Spec as JSON</label>
                <button
                  type="button"
                  className="mini"
                  onClick={() => dispatch({ type: "OPEN_JSON" })}
                >
                  edit raw spec…
                </button>
              </div>
            </div>
          </details>
        </div>
        <div className="railcol">
          <details className="group g-feed" open>
            <summary>Feed</summary>
            <div className="gbody">
              <FeedCards
                value={spec.feed}
                onChange={(token) =>
                  dispatch({ type: "PATCH_SPEC", patch: { feed: token } })
                }
              />
            </div>
          </details>

          <details className="group g-reflector" open>
            <summary>Reflector</summary>
            <div className="gbody">
              <Seg
                label="Type"
                options={[REFLECTOR_NONE, REFLECTOR_GROUND, REFLECTOR_RADIALS]}
                value={spec.reflector}
                onChange={(v) =>
                  dispatch({ type: "PATCH_SPEC", patch: { reflector: v } })
                }
              />
              {spec.reflector !== REFLECTOR_NONE && (
                <div className="field">
                  <span className="grouplabel">
                    Reflector to loop bottom
                    <ProvTag field="spacing" prov={prov} optStale={optStale} />
                  </span>
                  {/* One quantity, two units: edit either box and the other follows.
                  The units are plain text here rather than the bracketed .unit
                  chip, so they cannot be mistaken for the input boxes. */}
                  <div className="unitpair">
                    <input
                      id="spacing"
                      aria-label="reflector to loop bottom, in wavelengths"
                      className={flash("spacing").trim()}
                      title="reflector plane up to the bottom of the lower loop -- the clearance you can put a tape on"
                      type="number"
                      step="0.005"
                      value={Number(clearanceWl.toFixed(4))}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_REFLECTOR_FIELD",
                          field: "spacing",
                          value: spacingWlForClearance(
                            spec,
                            state.perimeterMm,
                            num(e.target.value, clearanceWl),
                          ),
                        })
                      }
                    />
                    <span className="u">&lambda;</span>
                    <span className="eq">=</span>
                    <input
                      id="spacing-mm"
                      aria-label="reflector to loop bottom, in millimeters"
                      className={flash("spacing").trim()}
                      title="the same clearance as a length; editing either box moves the other"
                      type="number"
                      step="1"
                      value={Number(clearanceMm.toFixed(1))}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_REFLECTOR_FIELD",
                          field: "spacing",
                          value: spacingWlForClearanceMm(
                            spec,
                            state.perimeterMm,
                            num(e.target.value, clearanceMm),
                          ),
                        })
                      }
                    />
                    <span className="u">mm</span>
                  </div>
                </div>
              )}
              {spec.reflector === REFLECTOR_RADIALS && (
                <div className="inline">
                  <div className="field">
                    <label htmlFor="count">
                      # Radials
                      <ProvTag field="count" prov={prov} optStale={optStale} />
                    </label>
                    <select
                      id="count"
                      className={flash("count").trim()}
                      value={spec.radialCount}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_REFLECTOR_FIELD",
                          field: "count",
                          value: num(e.target.value, spec.radialCount),
                        })
                      }
                    >
                      {[3, 4, 6, 8].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="droop">
                      Droop <span className="unit">deg</span>
                      <ProvTag field="droop" prov={prov} optStale={optStale} />
                    </label>
                    <input
                      id="droop"
                      className={flash("droop").trim()}
                      type="number"
                      step="1"
                      value={Number(spec.radialDroopDeg.toFixed(1))}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_REFLECTOR_FIELD",
                          field: "droop",
                          value: num(e.target.value, spec.radialDroopDeg),
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>

      <div className="actions">
        <button
          type="button"
          className="applybtn"
          onClick={onAnalyze}
          disabled={!analyzeEnabled}
        >
          {status === "analyzing" ? "analyzing…" : "Analyze"}
        </button>
        <div className="optnote">{analyzeNote}</div>
        {status === "analyzed" && (
          <div className="tune-hint">
            Analyzed, not tuned — run <b>Optimize</b> to reach quadrature.
          </div>
        )}
        <button type="button" className="optbtn" onClick={onOptimize} disabled={busy}>
          Optimize
        </button>
        <div className="optnote">
          tunes perimeter to quadrature; searches reflector · seconds to minutes
        </div>

        {status === "optimizing" && (
          <div className="optpanel">
            <div className="opthead">
              <span>{state.optProgress?.stage ?? "starting…"}</span>
              <button type="button" className="cancel" onClick={onCancelOptimize}>
                cancel
              </button>
            </div>
            <div className="bar">
              <i style={{ width: `${optFraction(state.optProgress)}%` }} />
            </div>
            <span style={{ color: "var(--muted)" }}>
              {state.optProgress
                ? `nec2c run ${state.optProgress.runs} · ${state.optProgress.elapsedS.toFixed(1)} s`
                : "warming up the solver"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
