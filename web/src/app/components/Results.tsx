// Right pane: results tabs with per-tier freshness. Tabs 2/3 (Charts, Sky maps)
// carry a freshness dot (stale after edits, pulsing while loading).

import type { Dispatch } from "react";
import type { Action, TabId, TierState, UiState } from "../state/types";
import { Charts } from "./Charts";
import { CutSheet } from "./CutSheet";
import { Files } from "./Files";
import { Model3D } from "./Model3D";
import { Schematic } from "./Schematic";
import { SkyMaps } from "./SkyMaps";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "cut", label: "Cut sheet" },
  { id: "sch", label: "Schematic" },
  { id: "charts", label: "Charts" },
  { id: "sky", label: "Sky maps" },
  { id: "3d", label: "3-D model" },
  { id: "files", label: "Files" },
];

function FreshDot({ state }: { state: TierState }): JSX.Element | null {
  if (state === "stale") {
    return <span className="freshdot stale" title="stale — edits since this compute" />;
  }
  if (state === "loading") {
    return <span className="freshdot loading" title="computing" />;
  }
  return null;
}

export function Results({
  state,
  dispatch,
  onPrintView,
  onToast,
}: {
  state: UiState;
  dispatch: Dispatch<Action>;
  onPrintView: () => void;
  onToast: (message: string) => void;
}): JSX.Element {
  const analysis = state.analysis;
  const veil = state.status === "analyzing" || state.status === "optimizing";
  return (
    <div className="results">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`tab${t.id === state.activeTab ? " on" : ""}`}
            aria-selected={t.id === state.activeTab}
            onClick={() => dispatch({ type: "SET_TAB", tab: t.id })}
          >
            {t.label}
            {t.id === "charts" && <FreshDot state={state.charts.state} />}
            {t.id === "sky" && <FreshDot state={state.sky.state} />}
          </button>
        ))}
      </div>
      <div className={`tabbody tuning-veil${veil ? " tuning" : ""}`}>
        {state.activeTab === "cut" && (
          <CutSheet
            text={analysis?.cutSheet ?? null}
            onPrintView={onPrintView}
            onCopied={onToast}
          />
        )}
        {state.activeTab === "sch" &&
          (analysis ? (
            <Schematic result={analysis.result} />
          ) : (
            <div className="ph">
              Run Analyze or Optimize to draw the feed and match.
            </div>
          ))}
        {state.activeTab === "charts" && (
          <Charts state={state.charts.state} data={state.charts.data} />
        )}
        {state.activeTab === "sky" && (
          <SkyMaps state={state.sky.state} data={state.sky.data} />
        )}
        {state.activeTab === "3d" && <Model3D result={analysis?.result ?? null} />}
        {state.activeTab === "files" && (
          <Files
            result={analysis?.result ?? null}
            resultJson={analysis?.resultJson ?? null}
            onToast={onToast}
          />
        )}
      </div>
    </div>
  );
}
