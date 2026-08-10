# tamago web

Web front end for the tamago eggbeater antenna design tool -- and, since the
Python CLI was retired, the whole of it. This directory holds the modeling
engine plus the React app shell. The clickable design contract is
`docs/web-ux.md` (mockup: `docs/web-ux-mockup.html`).

The engine began as a port of the Python implementation (`src/awadateki/`,
retired at commit `bff907e`); `goldens/` is that implementation's frozen output
and is still the reference the engine is tested against.

## Locked stack decisions

- React 18 + TypeScript (strict, `noUncheckedIndexedAccess`).
- Vite 5 build/dev, `@vitejs/plugin-react`.
- npm (committed `package-lock.json`); `node_modules` is gitignored.
- Vitest for tests; `@testing-library/react` + jsdom installed for the later UI
  wave (engine tests run under the `node` environment).
- Biome for lint + format (single toolchain, `biome.json`).
- The engine (`src/engine/`) is framework-free: zero React imports.
- Production build output goes to `../prebuilts/app/` (`build.outDir`,
  `emptyOutDir: true`) for the GitHub Pages site. `base: "./"` keeps asset URLs
  relative so the bundle works under the Pages subpath.
- The build stamps the git hash into the bundle and records it in
  `../prebuilts/app/version.json`. CI (the `web` job in
  `.github/workflows/ci.yml`) lints, tests, then rebuilds with that recorded
  hash (`TAMAGO_GIT_HASH`) and fails if the committed bundle differs from
  `src/` -- rebuild and commit `prebuilts/app` when changing the app.
- Rebuild locally with a plain `npm run build`, which stamps the current HEAD.
  Do **not** set `TAMAGO_GIT_HASH` by hand: CI sets it so it can reproduce a
  committed bundle, and passing the recorded value locally re-pins the stamp to
  whatever was already there. The drift check still passes -- it compares the
  rebuild against itself -- so a stale stamp goes unnoticed, and the printed
  report then cites a commit the bundle was not built from.

## Layout

- `src/engine/` -- the framework-free modeling engine (pure TypeScript).
- `src/app/` -- the React two-pane designer app (`docs/web-ux.md`): the app
  shell, spec rail, results tabs, print/report view, the engine Web Worker, and
  the reducer-based state. See "Web app (UI)" below.
- `test/` -- Vitest suites: the engine parity tests against `goldens/` plus a
  few React Testing Library UI tests (provenance flips, the Analyze flow with a
  mocked runner, the hash round-trip).
- `goldens/` -- frozen reference output; see `goldens/README.md`.
- `../prebuilts/app/` -- the committed production bundle for GitHub Pages.

NEC deck emission, output parsing and the solver itself are the `nec2c-deck`
and `nec2c-wasm` packages ([charlieh0tel/nec2c-js](https://github.com/charlieh0tel/nec2c-js)).
`engine/nec.ts` re-exports the first so the engine's imports stay local.

## Web app (UI)

The designer (`src/app/`) implements the settled UX contract (`docs/web-ux.md`),
reusing the mockup's design system verbatim as a global stylesheet
(`src/app/theme.css`; palette/typography/dark-theme tokens unchanged).

- **State**: one `useReducer` store (`state/reducer.ts`) is the single source of
  truth -- spec, per-field provenance (`user`/`est`/`opt`), a single global
  staleness flag (opt tags show `opt*` after any edit), tuning status, and the
  per-tier freshness of the lazy Charts/Sky tiers. No state-management library.
- **Engine worker** (`worker/`): a Vite module Web Worker owns the wasm nec2c
  runner and exposes `analyze` / `optimize` / `chartData` / `skyData` over
  `postMessage` with job ids, optimizer progress events, and cooperative
  cancellation. Progress + cancellation are implemented by *wrapping* the runner
  (the engine is untouched): the wrapper counts nec2c calls, emits progress, and
  throws to unwind an in-flight solve when the job is cancelled.
- **Analyze vs Optimize**: Analyze evaluates the literal on-screen perimeter
  (`loop_perimeter_mm`, or the closed-form estimate when absent) without
  re-tuning -- `engineExtras.analyzeLiteral` reconstructs the few pattern/current
  metrics that `design.ts` keeps private. Optimize runs the engine's
  `quadratureFactor` + `optimizeReflector` and writes the results back into the
  form as `opt`-provenance fields.
- **Results** consume the engine's own collectors: cut sheet from `report.ts`,
  feed schematic from `schematic.ts` (`renderFeedSchematic`), VSWR/AR charts from
  `plot.ts` `chartData`, polar az-el sky maps from `skyData`, and the 3-D orbit
  viewer (a React port of `awadateki/viewer.js`) from `tunedGeometry`. Files tab
  downloads spec/result/deck as blobs. `engineExtras.ts` is the thin seam that
  re-exports those engine APIs to the components.
- **Sharing/print**: the spec round-trips through `location.hash`
  (`#spec=base64url(JSON)`) and localStorage; `#report` deep-links the
  print/report view, which stamps the tool version + git hash (`version.ts`,
  injected by a Vite `define` at build time) so a bench printout is traceable.

## Commands

- `npm run dev` -- Vite dev server.
- `npm test` -- Vitest (one-shot); `npm run test:watch` to watch.
- `npm run build` -- `tsc -b` typecheck then `vite build` (writes to
  `../prebuilts/app/`; override `--outDir` for a throwaway build).
- `npm run lint` -- Biome check (format + lint) over `src` and `test`.

## Origin

The engine is a complete port of the retired Python implementation: `coax.py`,
`conductor.py`, `geometry.py`, `nec.py`, `spec.py`, `design.py`, `result.py`,
`report.py`, `schematic.py`, `plot.py`'s data collectors, and `viewer.js` all
have counterparts under `src/engine/` (plus `engine/format.ts`, which
reimplements Python's `%g` so reports format identically, and
`engine/validate.ts` and `engine/constants.ts`, which lift guards and constants
out of `design.py`). Three things were deliberately not carried over: `cli.py`
(the browser UI replaced it), `plot.py`'s standalone HTML/SVG renderers (the UI
renders `chartData`/`skyData` with its own React SVG components), and
`nec.py`'s `run_nec` subprocess (see "Engine conventions"). The Python is at
commit `bff907e` if a detail ever needs checking.

### Golden parity

`test/golden.test.ts` runs all 21 cases in `goldens/manifest.json` through the
WASM nec2c runner (`wasm/runner.mjs`), three assertions each:

- **Decks** (`buildDeckText`): byte-for-byte vs `<name>.deck.nec`, plus the one
  crossed (`deck-flipped`) case.
- **Result dicts** (`resultToDict(design(...))`): numeric leaves to 1e-9
  relative, strings/booleans exact, key order verified vs `<name>.result.json`.
  The WASM output is byte-identical to native nec2c, so these match well inside
  tolerance.
- **Cut sheets** (`formatCutSheet`): exact text vs `<name>.cutsheet.txt`. No
  float-formatting corner needed a documented exception.

All 63 pass, in about four seconds.

### Numeric invariants

These hold the goldens to the byte and must not drift:

- Deck emission is fixed-width text: `toFixed(6)` for GW/TL/EX coordinates and
  impedances, `toFixed(3)` for RP angles, card order
  `CM/CE/GW/GE/GN/EK/TL/EX/FR/RP/EN`, `RP` option code 1000.
- NEC tag layout is structural: loop A at 100+, loop B at 200+, reflector
  radials at 300+, harness ports at 400+. Segment counts above `MAX_SEGMENTS`
  (99) would collide the ranges, and the geometry builder raises first.
- The dense-resample geometry (cumulative arc length, `(k-0.5)/segments`
  straddle, `CURVE_SAMPLES`/`CORNER_ARC_SAMPLES`) uses floor-division modulo;
  JS `%` sign is corrected in `pythonMod`.
- `resultToDict` and `specToDict` emit a fixed key order, and omit optional
  fields rather than emitting `null`.

## Engine conventions

- **The engine does not run nec2c.** It formats decks and parses output;
  `NecRunner = (deck: string) => Promise<string>` is the seam. The worker
  supplies the WASM runner, tests supply fakes.
- **camelCase in TS, snake_case at the JSON boundary.** In-memory the engine
  uses camelCase (`z0Ohm`, `loopOffsetMm`); serialization maps to and from the
  spec's snake_case keys via an explicit field table in `spec.ts`.
- **Data-only interfaces.** What were Python `@property`s
  (`equivalentRadiusM`, `currentPhaseDeg`, `magnitude`, `feedCurrent`) are plain
  functions or eager fields; `Eggbeater.wires` is materialized at construction.
- **Spec JSON numbers are not byte-identical to the goldens' spec files.** JS
  has one number type, so `JSON.stringify` writes `5` where Python wrote `5.0`.
  Shape, key order, and round-trip semantics are identical, and only the *deck*
  is a byte target. Byte-identical spec JSON would need a serializer keyed on
  each field's int/float type.
- **`loop_perimeter_mm`** is an optional spec field with no Python counterpart,
  carried through round-trips and read by Analyze to evaluate a literal
  on-screen perimeter. It sits after `corner_radius_wl` in the key order, so
  specs without it keep the goldens' key order exactly.

## Not implemented

- **AntennaSim export**: checked and dropped. Neither of its file importers can
  carry the eggbeater's phased dual feed. The .nec importer discards TL cards;
  the .json importer reads only `excitations[0]` and its `setExcitation` forces
  the voltage to 1+0j (upstream `editorStore.ts`). Either way an import becomes
  a single loop-A source -- correct geometry, but no quadrature and the wrong
  pattern. Its backend `/api/v1/simulate` V2 accepts multiple complex
  excitations, but nothing in the app's file-import UI populates them, so there
  is no faithful "open in the app" path.
- **Optimizer progress detail**: the worker surfaces the coarse stage plus a
  running nec2c-run count and elapsed time; per-candidate cost/spacing is not
  shown because the engine optimizer exposes no callback. If it later grows a
  progress hook, wire it into `handleOptimize` in `worker/engineWorker.ts`.
