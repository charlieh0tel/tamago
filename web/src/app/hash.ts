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

// Spec keys that do NOT affect the modeled design or its computed metrics, and
// so are excluded from the analysis fingerprint: editing them must not stale a
// result.
const NON_ANALYSIS_KEYS = ["label", "notes", "optimization"];

// FNV-1a 32-bit hash, as 8 hex digits. Deterministic and dependency-free.
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// A stable short fingerprint of the analysis-affecting spec fields. Two specs
// share a fingerprint iff they would produce the same analysis; label, notes,
// and optimization metadata are ignored. Used to detect when displayed results
// no longer match the edited design. specToDict emits keys in a fixed order, so
// the serialization is stable.
export function analysisFingerprint(spec: DesignSpec): string {
  const dict = specToDict(spec);
  for (const key of NON_ANALYSIS_KEYS) {
    delete dict[key];
  }
  return fnv1a(JSON.stringify(dict));
}

// Build a shareable link (current origin + path) for a spec.
export function shareLink(spec: DesignSpec): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#spec=${encodeSpec(spec)}`;
}

export interface HashState {
  spec: DesignSpec | null;
  report: boolean;
  // A spec= fragment was present but could not be decoded (distinct from no
  // spec= at all, so a bad shared link is not silently treated as absent).
  specError: boolean;
}

// Parse the location hash into a spec and the report flag. Malformed specs are
// reported via specError (spec: null) rather than throwing.
export function parseHash(hash: string): HashState {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = body.split("&").filter(Boolean);
  let spec: DesignSpec | null = null;
  let report = false;
  let specError = false;
  for (const part of parts) {
    if (part === "report") {
      report = true;
    } else if (part.startsWith("spec=")) {
      try {
        spec = decodeSpec(part.slice("spec=".length));
      } catch {
        spec = null;
        specError = true;
      }
    }
  }
  return { spec, report, specError };
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
