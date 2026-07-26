# tamago web

Web front end for the tamago eggbeater antenna design tool. This directory holds
the TypeScript port of the Python engine (`src/awadateki/`) plus the React app
shell. The clickable design contract is `docs/web-ux.md` (mockup:
`docs/web-ux-mockup.html`).

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

## Layout

- `src/engine/` -- the framework-free port (pure TypeScript).
- `src/app/` -- the React two-pane designer app (`docs/web-ux.md`): the app
  shell, spec rail, results tabs, print/report view, the engine Web Worker, and
  the reducer-based state. See "Web app (UI)" below.
- `test/` -- Vitest suites: the ported engine parity tests plus a few React
  Testing Library UI tests (provenance flips, the Analyze flow with a mocked
  runner, the hash round-trip).
- `goldens/`, `wasm/`, `../prebuilts/` -- owned by other waves. The app builds
  into `../prebuilts/app/` and the worker loads the wasm runner from
  `../prebuilts/nec2c/` at run time.

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

## Port status

| Python module | TS module | status | notes |
|---|---|---|---|
| `coax.py` | `engine/coax.ts` | done | catalog, pairs, `RG_58_BALANCED`, nearest/lookup |
| `conductor.py` | `engine/conductor.ts` | done | round/strip/bar, bar GMD equivalent radius |
| `geometry.py` | `engine/geometry.ts` | done | wavelength, Wire/Loop/Eggbeater, circle/square/squircle dense resample, feed-gap split, loop offset, radials, extent |
| `nec.py` (deck + parsers) | `engine/nec.ts` | done (pure only) | `buildDeck` byte-identical cards; parsers for input params, radiation patterns (missing-sense LINEAR fallback), currents; `NecRunner` type for later WASM. Subprocess `run_nec` NOT ported |
| `spec.py` + `DesignSpec`/`Optimization` (from `design.py`) | `engine/spec.ts` | done | all fields/defaults; JSON round-trip (shape + key order); coax dict/name forms; optimization provenance; new optional `loop_perimeter_mm` |
| `design.py` geometry guards | `engine/validate.ts` | done | `validateSpec`: segment cap, loop-offset clearance, coax/feed applicability |
| `design.py` constants | `engine/constants.ts` | done | feed/reflector/sense names, harness cables, solver/grid/optimizer bounds, `NEC_SENSE_TO_HAND`, port geometry, sweep defaults |
| `design.py` (core) | `engine/design.ts` | done | center-z/reflector wires, three feed harnesses + port wires (crossed = negative Z0), `buildDeckText`, async `analyze`/`design` (takes a `NecRunner`), secant + golden-section solvers, `quadratureFactor`, pattern metrics (cone dedup, mean/worst AR, coverage gain, boresight sense, `wrapPhaseDeg`, loop balance), matching math (`vswr`, `postMatchVswr`, `matchedVswr`, `balun4RadioZ`, `lineInputZ`, `matchedInputZ`), `optimizeReflector`, `frequencySweep`, `bandwidthWithin` |
| `result.py` | `engine/result.ts` | done | `resultToDict` (build/performance sections, per-feed harness/match dicts) reproducing the Python key order; `resultsToJson` |
| `report.py` | `engine/report.ts` | done | `formatCutSheet`, `cutSheetBuild`, async `formatBandwidth`; byte-exact vs the goldens |
| -- | `engine/format.ts` | done | `formatG` (Python `%g`/`%.Ng`) for stock descriptions and reports |
| `schematic.py` | `engine/schematic.ts` | done | `renderFeedSchematic`; byte-identical SVG vs Python for all three feed layouts (line normal/crossed, turnstile, balun4 normal/crossed, plus synthetic series-L/C cases) -- see `test/fixtures/*.svg` |
| `plot.py` (data collectors only) | `engine/plot.ts` | done | `chartData` (frequency-sweep VSWR/AR series, elevation cut, 2:1 VSWR / 3 dB AR bandwidth) and `skyData` (gain/AR hemisphere maps); numeric parity vs Python to 1e-9 relative -- see `test/fixtures/{chart_data,sky_data}.json`. The SVG/HTML chart renderers in `plot.py` are not ported (later UI wave) |
| `design.py`'s `tuned_geometry` | `engine/design.ts` (`tunedGeometry`) | done | wire model + loop feed points for the 3-D viewer, reconstructed from the same geometry call as `analyze()` |

Not ported (next wave -- see below): `cli.py`, `plot.py`'s HTML/SVG renderers
and the 3-D orbit viewer (`viewer.js`), and the bandwidth-carrying variant of
`resultToDict` (opt-in; the goldens do not use it).

### Golden parity

`test/golden.test.ts` runs all 18 cases in `goldens/manifest.json` through the
WASM nec2c runner (`wasm/runner.mjs`):
- **Decks** (`buildDeckText`): byte-for-byte vs `<name>.deck.nec`, plus the one
  crossed (`deck-flipped`) case. All 18 pass.
- **Result dicts** (`resultToDict(design(...))`): numeric leaves to 1e-9
  relative, strings/booleans exact, key order verified vs `<name>.result.json`.
  All 18 pass (the WASM output is byte-identical to native, so they match well
  inside tolerance).
- **Cut sheets** (`formatCutSheet`): exact text vs `<name>.cutsheet.txt`. All 18
  pass. No float-formatting corner needed a documented exception.

The full golden suite (18 tuned designs, ~12 nec runs each) completes in about a
second. `@types/node` was added as a dev dependency so the parity tests can read
the golden files.

### Numeric fidelity

- Deck emission is byte-for-byte with Python: `%.6f` -> `toFixed(6)` for GW/TL/EX
  coordinates and impedances, `%.3f` -> `toFixed(3)` for RP angles, card order
  `CM/CE/GW/GE/GN/EK/TL/EX/FR/RP/EN`, `RP` option code 1000. Verified against
  `goldens/*.deck.nec` (GW feed-split ordering, `TL`, `FR`, `RP` all match).
- The dense-resample geometry (cumulative arc length, `(k-0.5)/segments`
  straddle, `CURVE_SAMPLES`/`CORNER_ARC_SAMPLES`) is ported verbatim, including
  Python's floor-division modulo (JS `%` sign is corrected in `pythonMod`).

## Deliberate deviations

- **Spec JSON number formatting is not byte-identical.** Python's `json.dumps`
  writes whole-number floats with a trailing `.0` (`5.0`, `50.0`); JavaScript's
  `JSON.stringify` collapses them (`5`, `50`) because JS has a single number
  type. The spec's shape, key order, and round-trip semantics are identical
  (verified against `goldens/*.spec.json`), which is what the task requires;
  exact byte matching of the spec JSON is not (only the *deck* is a byte target).
  If a later wave needs byte-identical spec JSON, a custom serializer keyed on
  each field's int/float type would be required.
- **camelCase in TS, snake_case at the JSON boundary.** In-memory the engine uses
  camelCase (`z0Ohm`, `loopOffsetMm`); serialization maps to/from the Python
  snake_case keys via an explicit field table in `spec.ts`.
- **Computed dataclass properties are functions.** Python `@property`s
  (`equivalent_radius_m`, `current_phase_deg`, `magnitude`, `feed_current`, the
  `Eggbeater.wires` concatenation) become plain functions / eager fields since
  TS interfaces are data-only. `Eggbeater.wires` is materialized at construction.
- **`loop_perimeter_mm`** (new optional field from `docs/web-ux.md`) is carried
  through round-trips but absent by default; nothing consumes it yet. It is
  inserted after `corner_radius_wl` in the key order (Python never emits it, so
  specs without it stay byte-order-identical to Python output).
- **`run_nec` subprocess is not ported.** `NecRunner = (deck: string) =>
  Promise<string>` is exported for the WASM bridge instead.

## Remaining surface (next wave)

- **`plot.py`'s HTML/SVG renderers / `render_artifact`**: the standalone
  self-contained HTML artifact is not ported. The UI renders `chartData` /
  `skyData` with its own React SVG components (Charts, SkyMaps) instead.
- **`cli.py`**: argument parsing and the emit-spec/emit-result/deck entry points
  (the browser equivalent is the UI).
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
  shown because the engine optimizer exposes no callback and must not be
  modified. If the engine later grows a progress hook, wire it into
  `handleOptimize` in `worker/engineWorker.ts`.

The UI (two-pane spec editor, results tabs, provenance/staleness chips,
URL-fragment sharing, print/report view) and the `plot.ts` chart/sky collectors,
`schematic.ts`, and the 3-D `viewer.js` port are all done -- see "Web app (UI)".
