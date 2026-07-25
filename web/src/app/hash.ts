// URL-fragment sharing and localStorage persistence (docs/web-ux.md).
//
// The spec is encoded in the location hash as #spec=base64url(JSON); a design
// link plus the tool version reproduces a result. #report deep-links the print
// view. Last state is mirrored to localStorage for restore on next visit.

import { type DesignSpec, specFromDict, specToDict } from "../engine/index";

const STORAGE_KEY = "tamago:last-spec";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeSpec(spec: DesignSpec): string {
  const json = JSON.stringify(specToDict(spec));
  return toBase64Url(new TextEncoder().encode(json));
}

export function decodeSpec(encoded: string): DesignSpec {
  const json = new TextDecoder().decode(fromBase64Url(encoded));
  return specFromDict(JSON.parse(json));
}

// Build a shareable link (current origin + path) for a spec.
export function shareLink(spec: DesignSpec): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#spec=${encodeSpec(spec)}`;
}

export interface HashState {
  spec: DesignSpec | null;
  report: boolean;
}

// Parse the location hash into a spec and the report flag. Malformed specs are
// ignored (spec: null) rather than throwing.
export function parseHash(hash: string): HashState {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = body.split("&").filter(Boolean);
  let spec: DesignSpec | null = null;
  let report = false;
  for (const part of parts) {
    if (part === "report") {
      report = true;
    } else if (part.startsWith("spec=")) {
      try {
        spec = decodeSpec(part.slice("spec=".length));
      } catch {
        spec = null;
      }
    }
  }
  return { spec, report };
}

export function writeSpecHash(spec: DesignSpec, report: boolean): void {
  const frag = `spec=${encodeSpec(spec)}${report ? "&report" : ""}`;
  // Replace, not push, so editing does not spam browser history.
  history.replaceState(null, "", `#${frag}`);
}

export function saveLastSpec(spec: DesignSpec): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(specToDict(spec)));
  } catch {
    // Ignore quota / private-mode failures; persistence is best-effort.
  }
}

export function loadLastSpec(): DesignSpec | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    return specFromDict(JSON.parse(raw));
  } catch {
    return null;
  }
}
