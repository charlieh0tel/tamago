# Golden reference files for the tamago TypeScript port

This directory holds deterministic reference output from the Python
awadateki implementation (the source of truth), for the TS port to diff
its own output against. Everything here is generated; do not hand-edit.

## Regenerating

    uv run python web/goldens/generate.py

Re-running is a no-op change: nec2c and the awadateki pipeline are
deterministic given the same inputs, so two consecutive runs produce
byte-identical files (verified during generation of this set; diff -rq
across two runs was empty).

## Layout

For each case `<name>` in `generate.py`'s `CASES` list:

- `<name>.spec.json` -- `spec_to_dict(spec)`, the canonical spec JSON
  (same shape the CLI reads/writes).
- `<name>.deck.nec` -- the NEC-2 deck text at a **fixed** perimeter factor
  (1.05), via `_build_deck_text(spec, 1.05, False, None, None)`. This is
  the pure-geometry golden: no tuning loop, no nec2c invocation, so it
  isolates the geometry/deck-emission code from the numerical solver.
- `<name>.deck-flipped.nec` -- same, with `flip=True` (crossed harness
  connection). Emitted only for `line_none_circle_lhcp_2m`, to exercise
  the crossed-line code path once.
- `<name>.result.json` -- `result_to_dict(design(spec))`, the full tuned
  design: spec echo, build cut list, and predicted performance.
- `<name>.cutsheet.txt` -- `format_cut_sheet(design(spec))`, the
  human-readable text report rendered from the same result dict.

`manifest.json` lists every case with its key parameters and a few tuned
numbers pulled from the result (base_factor, phase_diff_deg, z_in,
axial-ratio mean/worst), plus the git commit (`git rev-parse --short
HEAD`) the set was generated from.

## Case matrix (21 cases)

| name | feed | reflector | shape | sense | band | conductor | segments |
|---|---|---|---|---|---|---|---|
| line_none_circle_rhcp_2m | line | none | circle | rhcp | 2m | round | 16 |
| line_none_circle_lhcp_2m | line | none | circle | lhcp | 2m | round | 16 |
| line_ground_circle_rhcp_2m | line | ground | circle | rhcp | 2m | round | 16 |
| line_radials_circle_rhcp_2m | line | radials | circle | rhcp | 2m | round | 16 |
| line_radials_droop_circle_rhcp_2m | line | radials (count=4, droop=25deg) | circle | rhcp | 2m | round | 16 |
| line_none_square_rhcp_70cm | line | none | square | rhcp | 70cm | round | 16 |
| line_none_squircle_rhcp_70cm | line | none | squircle (corner_radius_wl=0.08) | rhcp | 70cm | round | 16 |
| line_none_circle_rhcp_2m_matchcoax | line (explicit match_coax=RG-59) | none | circle | rhcp | 2m | round | 16 |
| line_none_circle_rhcp_2m_phasingcoax | line (explicit phasing_coax=RG-58) | none | circle | rhcp | 2m | round | 16 |
| line_none_circle_rhcp_2m_bar | line | none | circle | rhcp | 2m | bar (6x3mm) | 16 |
| balun4_none_circle_rhcp_2m | balun4 | none | circle | rhcp | 2m | round | 16 |
| balun4_none_circle_lhcp_2m | balun4 | none | circle | lhcp | 2m | round | 16 |
| balun4_radials_squircle_rhcp_70cm | balun4 | radials | squircle (corner_radius_wl=0.08) | rhcp | 70cm | bar (6x3mm) | 16 |
| choke_none_circle_rhcp_2m | choke | none | circle | rhcp | 2m | round | 16 |
| choke_none_circle_lhcp_2m | choke | none | circle | lhcp | 2m | round | 16 |
| choke_radials_squircle_rhcp_70cm | choke | radials | squircle (corner_radius_wl=0.08) | rhcp | 70cm | bar (6x3mm) | 16 |
| line_none_circle_rhcp_2m_full36 | line | none | circle | rhcp | 2m | round | 36 (full) |
| balun4_none_circle_rhcp_2m_full36 | balun4 | none | circle | rhcp | 2m | round | 36 (full) |
| line_none_square_rhcp_2m_derived | line | none | square | rhcp | 2m | round | derived |
| line_none_circle_rhcp_2m_derived | line | none | circle | rhcp | 2m | round | derived |
| line_none_squircle_rhcp_70cm_derived | line | none | squircle (corner_radius_wl=0.05) | rhcp | 70cm | round | derived |

Notes on coverage:
- Every feed scheme (line, balun4, choke) has both an rhcp and an lhcp
  case, so the crossed-connection path (`crossed_phasing_line` /
  `Optimization`-free direct spec) is exercised per feed. lhcp forces the
  crossed harness connection for these geometries -- check
  `<name>.result.json`'s `spec.sense` vs. `build.*.connection` /
  `performance.sense_achieved`, and `manifest.json`'s
  `crossed_phasing_line` field.
- Reflector none/ground/radials all appear; radials appear once at
  defaults and once with a non-default radial_count and radial_droop_deg.
- All three loop shapes appear (circle, square, squircle); square and
  squircle use segments=16 (divisible by 4).
- Both bands (145.9, 436.0 MHz) and both conductor kinds (round, bar) are
  covered.
- One line-feed case pins `match_coax` explicitly, another pins
  `phasing_coax` explicitly, to exercise the override path (as opposed to
  the catalog-nearest-match default).
- Two cases use the library default segment count (36) instead of the
  16 used elsewhere for speed.
- Three cases leave `segments` unset so the mesh is derived, one per
  rounding path: a square (only the conductor-radius target binds), a
  circle, and a squircle (whose tight corners make the geometric floor
  bind hardest). Every other case pins a count, which had left the whole
  derivation -- and so a real Python/TypeScript rounding divergence --
  outside the comparison.

## Comparison contract for the TS port

- **Decks (`.deck.nec`, `.deck-flipped.nec`)**: byte-for-byte identical.
  These are plain ASCII text with fixed `%.6f`-equivalent formatting for
  every coordinate/impedance/length field (see `nec.py:build_deck`); there
  is no floating-point tolerance here since both sides format to a fixed
  number of decimal places.
- **Result JSON (`.result.json`, and `.spec.json`)**: every numeric leaf
  must match to 1e-9 relative tolerance (`abs(a-b) <= 1e-9 * max(abs(a),
  abs(b), 1e-9)` is a reasonable check). Do not compare JSON text directly
  -- see the float-repr quirk below.
- **Cut sheet (`.cutsheet.txt`)**: exact text match. All numbers in the
  cut sheet are already rounded to their display precision (1 decimal for
  mm/ohms, 2 for dB/VSWR, etc. -- see `report.py`'s format strings), so
  this is a plain string comparison, not a numeric one.

## Python-side quirks a porter must know

- **Float repr in JSON**: Python's `json.dumps` serializes floats using
  `repr()`, which is the shortest decimal string that round-trips to the
  same IEEE-754 double (e.g. `0.1` stays `0.1`, never `0.1000000000001`
  or `0.099999...`). JS's default `JSON.stringify`/`Number.toString()`
  uses the same "shortest round-trip" algorithm (both follow
  Grisu/Ryu-family shortest-repr conventions), so in practice values that
  originate from the same computation serialize to the same digit string
  in both languages -- but do not rely on that for values computed via a
  different code path or operation order; compare numerically (1e-9
  relative), not as strings, except where noted above.
- **Integers that happen to be floats**: fields like `diameter_mm: 5.0`
  or `radial_droop_deg: 0.0` are always emitted with a trailing `.0`
  (Python floats always print with a decimal point). A JS port must make
  sure its serializer does the same for fields typed as floats (JS
  numbers don't distinguish int/float, so `JSON.stringify` would emit
  `5` unless the port special-cases this) if it intends byte-identical
  JSON; if it only needs numeric-tolerance comparison this does not
  matter.
- **Dict/field ordering**: `spec_to_dict` and `result_to_dict` build plain
  dicts with fields inserted in a fixed, documented order (see
  `spec.py`'s `_OPTIONAL_FIELDS` tuple and the `_build_dict`/
  `_performance_dict` functions in `result.py`); Python 3.7+ dicts
  preserve insertion order and `json.dumps` respects it. The TS port
  should reproduce the same field order if it wants byte-identical JSON;
  otherwise a structural (key-by-key) comparison sidesteps this.
- **Optional fields are omitted, not null**: `spec_to_dict` skips any
  field whose value is `None` (see `spec.py`) rather than emitting
  `"field": null`. `label` and `notes` are the only spec fields that can
  be absent this way in practice for these goldens (none of the cases set
  them, so they never appear); `phasing_coax`/`match_coax` likewise only
  appear in the two cases that override them.
- **No entity/HTML escaping anywhere in these goldens**: NEC decks are
  plain fixed-column text (no escaping rules at all -- see
  `nec.py:build_deck`, which does plain `f"{value:.6f}"` formatting), and
  the cut sheet is plain text. JSON string escaping is the usual JSON
  escaping (quotes, backslashes, control characters) and both Python's
  `json` module and JS's `JSON.stringify` follow the JSON spec
  identically here, so this is not a source of divergence.
- **Complex numbers are split fields**: `z_in` (a Python `complex`) is
  never serialized directly; it always appears as two float fields, e.g.
  `feed_z_ohm: {"real": ..., "imag": ...}` (see `result.py:
  _performance_dict`). The manifest also splits it into `z_in_real` /
  `z_in_imag`.
- **NEC tag numbering is a structural invariant, not a quirk**: loop A
  occupies tags 100+, loop B tags 200+, harness ports 400+, reflector
  radials 300+ (`geometry.py`); segment counts above `MAX_SEGMENTS` (99)
  would collide these ranges and `_eggbeater` raises before emitting a
  deck. The port must reproduce this tag layout exactly for
  `.deck.nec` byte-for-byte comparison to mean anything.
