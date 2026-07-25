// Cut-sheet tab: the pre-rendered text cut sheet (report.ts) with print-view
// and copy actions. Always current with the last Analyze.

export function CutSheet({
  text,
  onPrintView,
  onCopied,
}: {
  text: string | null;
  onPrintView: () => void;
  onCopied: (message: string) => void;
}): JSX.Element {
  if (text === null) {
    return <div className="ph">Run Analyze or Optimize to render the cut sheet.</div>;
  }
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      onCopied("copied cut sheet text");
    } catch {
      onCopied("copy failed — select the text manually");
    }
  };
  return (
    <div>
      <div className="cutbar">
        <button type="button" className="mini" onClick={onPrintView}>
          print view
        </button>
        <button type="button" className="mini" onClick={() => void copy()}>
          copy text
        </button>
      </div>
      <pre className="cut">{text}</pre>
    </div>
  );
}
