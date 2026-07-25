// Tool version, injected by Vite `define` at build time (see vite.config.ts).
// Shown in the header chip and the print/report provenance line so a printout
// is traceable to a code version, per docs/web-ux.md.

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const GIT_HASH: string = typeof __GIT_HASH__ === "string" ? __GIT_HASH__ : "dev";

// "v0.1.0 - 7af9063" style label for the header chip.
export const VERSION_LABEL = `v${APP_VERSION} · ${GIT_HASH}`;
// "v0.1.0 (7af9063)" style label for the report provenance line.
export const VERSION_PAREN = `v${APP_VERSION} (${GIT_HASH})`;
