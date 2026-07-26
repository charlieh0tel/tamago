# Web front end: UX design

Status: design settled (2026-07); implementation not started. A clickable
mockup with canned data was built to converge on this design
(`docs/web-ux-mockup.html` -- self-contained, open in any browser); this
document is the contract it converged to.

## Scope and principles

- One design per page. A page holds exactly one spec; pairs and comparisons
  are two browser tabs. (Multi-design lists remain a CLI/file concept.)
- Fully static. The app is a page on the existing GitHub Pages site: nec2c
  compiled to WebAssembly, no server, no accounts. Long work runs in a Web
  Worker with progress.
- The form is the design. Everything the solvers decide is written back into
  ordinary, editable form fields; there is no hidden derived state. The spec
  (JSON) remains the canonical representation; a raw-JSON editor is
  available.
- Honest status, always visible: tuned/not-tuned, achieved sense, and the
  delivered (normal/crossed) loop B connection are shown as header chips.

## Layout

Two panes under a header strip.

- Header: title (tamago + Japanese), repo link, tool version chip
  ("v0.1.0 - 7af9063": semver plus git hash), status chips, copy-design-link
  button.
- Left rail (sticky): the spec editor in collapsible groups mirroring the
  spec's progressive disclosure -- Basics (frequency, label, conductor, loop
  perimeter, shape, sense), Feed, Reflector, Advanced (offset, gap,
  segments, system Z, AR margin, raw JSON). Action buttons at the bottom.
- Right pane: results tabs -- Cut sheet, Schematic, Charts, Sky maps,
  3-D model, Files.
- Narrow screens stack the rail above the results; the cut sheet must read
  well on a phone.

## Actions

| action | what it does | cost |
|---|---|---|
| estimate (per-field) | closed-form perimeter into the field | instant |
| Analyze | one nec2c evaluation of exactly what is on screen | ~1 s |
| Optimize | solve perimeter to quadrature; search the reflector when one exists; write all results into the form fields | seconds without radials, minutes with |

- Analyze never solves anything. It evaluates the literal spec, including a
  hand-entered perimeter. (Maps to the existing `analyze(spec, factor)`
  primitive.)
- Optimize is the only solver, covering both the quadrature tuning and the
  reflector search. It shows a progress panel (stage, current candidate,
  cost) and is cancellable; on completion the affected fields flash and
  their provenance tags flip to `opt`. There is no separate confirmation
  dialog -- pressing Optimize is the consent, and results land in editable
  fields.
- Any spec edit enables Analyze and sets the status chip to
  "edited -- not analyzed".

## Provenance and staleness

Every solver-writable field (loop perimeter; reflector spacing, droop,
count) carries a small provenance tag:

- `user` -- set by the user; a constant until touched again.
- `est` -- a live closed-form formula. Est-tagged fields re-derive
  automatically when their inputs (frequency, shape) change; touching the
  field directly flips it to `user`.
- `opt` -- a snapshot from an Optimize run.

Staleness is a single global flag, not a dependency graph: in an EM problem
essentially every output depends on every input, so any edit after an
Optimize run marks all `opt` tags as `opt*` (dimmed, dashed border, tooltip
"optimizer value, but inputs changed since that run"). Re-running Optimize
clears it. Editing a tagged field always sets that field to `user`.

Analyze reports through the status chip according to provenance: a fresh
`opt` perimeter yields "tuned - quadrature +89.9 deg" (good); anything else
yields an amber "analyzed -- phase +84.1 deg, not tuned".

## Feed selection

The three schemes are picker cards named for the hardware -- "Phasing
line", "Turnstile", "4:1 balun" -- with the spec token (`line`,
`turnstile`, `balun4`) small in the tag line, a one-line trade-off
("simplest, one coax" / "best current balance" / "balanced feed, F5VIF"),
and the scheme's real schematic line art as the card art.

## Results tabs and the cost tiers

Computation is tiered; the UI shows freshness per tier:

- Tier 1 (~10 nec2c runs, seconds): tuning-state, cut sheet, schematic,
  Files. Refreshed by Analyze.
- Tier 2 (~40-60 runs): frequency sweep -- VSWR/AR charts and bandwidths.
- Tier 3 (~50+ runs): sky maps, fine elevation cut.

Tiers 2-3 compute lazily (when their tab is visited, or in the background
after the spec has been quiet), with a spinner on the tab and a stale/gray
state after edits. The cut sheet is always current with the last Analyze.

- Cut sheet: the text cut sheet, print-styled, with print/copy actions.
- Schematic: the feed/match drawing for the selected scheme.
- Charts: VSWR and axial-ratio vs frequency offset with 2:1 / 3 dB limit
  lines and hover crosshair.
- Sky maps and 3-D model: the existing plot-page components (polar az-el
  heatmaps; orbit viewer).
- Files: download spec JSON, result JSON, tuned NEC deck. (No AntennaSim
  export: its import keeps only one real-voltage feed, so the phased dual
  feed cannot survive -- see web/README.md.)

## Print / report view

A "print view" action assembles a single document: title block; a
provenance line with tool version and git hash ("tool v0.1.0 (7af9063)"),
the repo, and the design link; then cut sheet, schematic, charts, sky maps.
`@media print` strips all chrome so browser Print produces the report. The
report is deep-linkable (`#report`) and must include the tool version and
hash -- a bench printout is traceable to code version and inputs.

## Sharing and persistence

The spec is encoded in the URL fragment (`#spec=...`), making designs
bookmarkable and shareable with no server; last state also goes to
localStorage. A design link plus the tool version fully reproduces a
result.

## Spec/API implications

- New optional spec field `loop_perimeter_mm`: when present, Analyze
  evaluates it literally; when absent, CLI behavior is unchanged (Optimize
  or the CLI tunes). The optimizer writes it back (with the existing
  `optimization` provenance block).
- The web Analyze/Optimize map onto the existing `analyze()` /
  `_quadrature_factor()` + `optimize_reflector()` machinery; nec2c
  invocation needs a runner abstraction (subprocess natively, a WASM bridge
  in the browser).

## Open items

- Implementation path: Pyodide (reuse the Python verbatim) vs a TypeScript
  migration (Python deprecated afterward). Owner leaning toward deprecating
  Python; decision parked.
- Units: mm only for now; an inches toggle for cut lengths is undecided.
- Whether multi-design lists should eventually leave the CLI too; parked.
