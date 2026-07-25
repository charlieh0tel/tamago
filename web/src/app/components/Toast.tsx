// Transient toast, shown at the bottom of the viewport.

import { useEffect } from "react";

export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}): JSX.Element {
  useEffect(() => {
    if (message === null) {
      return;
    }
    const handle = setTimeout(onDismiss, 2400);
    return () => clearTimeout(handle);
  }, [message, onDismiss]);
  return <div className={`toast${message ? " show" : ""}`}>{message ?? ""}</div>;
}
