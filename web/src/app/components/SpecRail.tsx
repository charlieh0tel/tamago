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
} from "../../engine/index";
import type { Action, ProvField, ProvenanceMap, UiState } from "../state/types";
import { buildConductor } from "../state/uiSpec";
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
      <details className="group" open>
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
                onChange={(e) => dispatch({ type: "SET_LABEL", value: e.target.value })}
              />
            </div>
          </div>

          <Seg
            label="Conductor"
            options={[KIND_ROUND, KIND_STRIP, KIND_BAR]}
            value={kind}
            onChange={(k) => {
              const d = k === KIND_BAR ? [dims[0] ?? 5, dims[1] ?? 2] : [dims[0] ?? 5];
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
            onChange={(v) => dispatch({ type: "PATCH_SPEC", patch: { loopShape: v } })}
          />
          <Seg
            label="Polarization sense"
            options={[SENSE_RHCP, SENSE_LHCP]}
            value={spec.sense}
            onChange={(v) => dispatch({ type: "PATCH_SPEC", patch: { sense: v } })}
          />
        </div>
      </details>

      <details className="group" open>
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

      <details className="group" open>
        <summary>Reflector</summary>
        <div className="gbody">
          <Seg
            label="Type"
            options={[REFLECTOR_NONE, REFLECTOR_GROUND, REFLECTOR_RADIALS]}
            value={spec.reflector}
            onChange={(v) => dispatch({ type: "PATCH_SPEC", patch: { reflector: v } })}
          />
          {spec.reflector !== REFLECTOR_NONE && (
            <div className="inline">
              <div className="field">
                <label htmlFor="spacing">
                  Spacing <span className="unit">wl</span>
                  <ProvTag field="spacing" prov={prov} optStale={optStale} />
                </label>
                <input
                  id="spacing"
                  className={flash("spacing").trim()}
                  type="number"
                  step="0.005"
                  value={spec.reflectorSpacingWl}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_REFLECTOR_FIELD",
                      field: "spacing",
                      value: num(e.target.value, spec.reflectorSpacingWl),
                    })
                  }
                />
              </div>
              {spec.reflector === REFLECTOR_RADIALS && (
                <div className="field">
                  <label htmlFor="count">
                    Radials
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
              )}
            </div>
          )}
          {spec.reflector === REFLECTOR_RADIALS && (
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
                value={spec.radialDroopDeg}
                onChange={(e) =>
                  dispatch({
                    type: "SET_REFLECTOR_FIELD",
                    field: "droop",
                    value: num(e.target.value, spec.radialDroopDeg),
                  })
                }
              />
            </div>
          )}
        </div>
      </details>

      <details className="group">
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
              <label>Segments</label>
              <input
                type="number"
                value={spec.segments}
                onChange={(e) =>
                  dispatch({
                    type: "PATCH_SPEC",
                    patch: { segments: Math.round(num(e.target.value, spec.segments)) },
                  })
                }
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

      <button
        type="button"
        className="applybtn"
        onClick={onAnalyze}
        disabled={!analyzeEnabled}
      >
        {status === "analyzing" ? "analyzing…" : "Analyze"}
      </button>
      <div className="optnote">{analyzeNote}</div>
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
            <i
              style={{ width: `${Math.min(95, (state.optProgress?.runs ?? 0) * 2)}%` }}
            />
          </div>
          <span style={{ color: "var(--muted)" }}>
            {state.optProgress
              ? `nec2c run ${state.optProgress.runs} · ${state.optProgress.elapsedS.toFixed(1)} s`
              : "warming up the solver"}
          </span>
        </div>
      )}
    </div>
  );
}
