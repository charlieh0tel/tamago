// Raw-JSON spec editor modal. Round-trips through spec.ts: the current spec is
// serialized in, edits are parsed back and applied as a fresh spec load.

import { useState } from "react";
import { type DesignSpec, specsFromJson, specsToJson } from "../../engine/index";

export function JsonModal({
  spec,
  onApply,
  onClose,
}: {
  spec: DesignSpec;
  onApply: (spec: DesignSpec) => void;
  onClose: () => void;
}): JSX.Element {
  const [text, setText] = useState(() => specsToJson([spec]));
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    try {
      const specs = specsFromJson(text);
      const first = specs[0];
      if (first === undefined) {
        setError("no spec found in the JSON");
        return;
      }
      onApply(first);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit raw spec JSON"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Spec JSON</h3>
        <textarea
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && <div className="err">{error}</div>}
        <div className="actions">
          <button type="button" className="mini" onClick={onClose}>
            cancel
          </button>
          <button type="button" className="applybtn" onClick={apply}>
            apply
          </button>
        </div>
      </div>
    </div>
  );
}
