// Ambient type for the untyped WASM runner (web/wasm/runner.mjs), imported by
// the design/golden parity tests. web/wasm is owned by another wave and is not
// modified here; this declaration lives in the test tree instead.
declare module "*/runner.mjs" {
  export function runNec(deck: string): Promise<string>;
}
