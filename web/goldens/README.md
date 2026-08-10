# Frozen golden reference files

Deterministic reference output from the retired Python implementation
(`src/awadateki/`, last present at commit `bff907e`), which the TypeScript
engine is tested against. Everything here is generated; do not hand-edit.

**These files are frozen.** The generator (`generate.py`) went with the Python.
Adding a case now means either reviving that implementation from git history or
reconstructing the case against the TS engine, which would make it a
self-comparison rather than a golden. Treat the set as fixed regression
coverage: `test/golden.test.ts` must keep passing against it unchanged.

One correction postdates them: at a pattern null the parser now reports the
polarization sense as `UNDEFINED` rather than `LINEAR`. No golden value
changes, since neither maps to a handedness.

`manifest.json` records the commit the set was generated from
(`git_commit`: `a4f327e`) alongside every case and a few tuned numbers pulled
from its result (base_factor, phase_diff_deg, z_in, axial-ratio mean/worst).

## Layout

For each case `<name>` in `manifest.json`:

- `<name>.spec.json` -- the canonical spec JSON.
- `<name>.deck.nec` -- the NEC-2 deck text at a **fixed** perimeter factor
  (1.05). This is the pure-geometry golden: no tuning loop, no nec2c
  invocation, so it isolates geometry and deck emission from the numerical
  solver.
- `<name>.deck-flipped.nec` -- same, with the crossed harness connection.
  Emitted only for `line_none_circle_lhcp_2m`, to exercise the crossed-line
  code path once.
- `<name>.result.json` -- the full tuned design: spec echo, build cut list, and
  predicted performance.
- `<name>.cutsheet.txt` -- the human-readable text report, rendered from the
  same result.

## Comparison contract

- **Decks (`.deck.nec`, `.deck-flipped.nec`)**: byte-for-byte identical. Plain
  ASCII with fixed 6-decimal formatting for every coordinate, impedance, and
  length, so there is no floating-point tolerance to apply.
- **Result JSON (`.result.json`, `.spec.json`)**: every numeric leaf to 1e-9
  relative tolerance. Compare structurally, not as text -- JS has a single
  number type and writes `5` where Python wrote `5.0`.
- **Cut sheet (`.cutsheet.txt`)**: exact text match. Every number is already
  rounded to its display precision, so this is a plain string comparison.

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
