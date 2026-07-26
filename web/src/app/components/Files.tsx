// Files tab: download spec.json / result.json / deck.nec as blobs.
// No AntennaSim export: its import (both .nec and .json) keeps only a single
// real-voltage excitation, so the eggbeater's phased dual feed collapses to a
// single-fed loop -- geometry survives, the quadrature does not.

import { type DesignResult, specsToJson } from "../../engine/index";

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function baseName(result: DesignResult): string {
  const label = result.spec.label;
  return (label ?? "eggbeater").replace(/\s+/g, "_").toLowerCase();
}

export function Files({
  result,
  resultJson,
  onToast,
}: {
  result: DesignResult | null;
  resultJson: string | null;
  onToast: (message: string) => void;
}): JSX.Element {
  if (result === null || resultJson === null) {
    return (
      <div className="ph">Run Analyze or Optimize to produce downloadable files.</div>
    );
  }
  const base = baseName(result);
  const rows: Array<{ name: string; desc: string; make: () => void }> = [
    {
      name: `${base}.json`,
      desc: "design spec",
      make: () =>
        download(`${base}.json`, specsToJson([result.spec]), "application/json"),
    },
    {
      name: `${base}.result.json`,
      desc: "cut list + performance",
      make: () => download(`${base}.result.json`, resultJson, "application/json"),
    },
    {
      name: `${base}.nec`,
      desc: "tuned NEC deck",
      make: () => download(`${base}.nec`, result.deck, "text/plain"),
    },
  ];
  return (
    <div className="filelist">
      {rows.map((r) => (
        <div className="filerow" key={r.name}>
          <span className="fname">{r.name}</span>
          <span className="fdesc">{r.desc}</span>
          <button
            type="button"
            onClick={() => {
              r.make();
              onToast(`downloaded ${r.name}`);
            }}
          >
            download
          </button>
        </div>
      ))}
    </div>
  );
}
