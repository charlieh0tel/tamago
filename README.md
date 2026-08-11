# Tamago awadateki (卵泡立て器)

[![CI](https://github.com/charlieh0tel/tamago/actions/workflows/ci.yml/badge.svg)](https://github.com/charlieh0tel/tamago/actions/workflows/ci.yml)

Eggbeater antenna dimension generator with `nec2c` in the tuning loop.

An eggbeater is two full-wave loops in perpendicular vertical planes, fed in
phase quadrature to give a near-omnidirectional, circularly polarized pattern
with good high-angle coverage (popular for working LEO satellites). This tool
sets the geometry from closed-form formulas and then uses `nec2c` to tune the
loop currents to 90 degree quadrature, finishing with a physical cut sheet.

The designer runs in the browser at <https://charlieh0tel.github.io/tamago/> --
a TypeScript engine with nec2c compiled to WebAssembly, so nothing is installed
and nothing leaves the machine. See `web/README.md`.

## Requirements

A browser. The solver ships with the page as WebAssembly; there is no server
and no local toolchain to install. For development, see
[Development](#development).

## Usage

A design is a JSON spec. Only `freq_mhz` and `conductor` are required; every
other field defaults. The pipeline is **spec -> optimized spec (optional) ->
derived artifacts** (cut sheet, NEC deck, plots), so every artifact reflects
exactly the spec it was handed.

The spec rail on the left edits the spec directly; the Files tab imports and
exports it as JSON. A design also round-trips through the URL
(`#spec=base64url(JSON)`), so a link carries the whole design -- that is the
way to save or share one.

### Spec (JSON)

```json
{
  "freq_mhz": 145.9,
  "conductor": {"kind": "round", "diameter_mm": 5.0},
  "sense": "rhcp",
  "reflector": "radials",
  "reflector_spacing_wl": 0.20,
  "radial_count": 8,
  "radial_length_wl": 0.27,
  "radial_droop_deg": 45.0,
  "phasing_coax": "RG-62",
  "system_z_ohm": 50.0,
  "segments": 36,
  "label": "2 m"
}
```

- `conductor` is `{"kind":"round","diameter_mm":d}`,
  `{"kind":"strip","width_mm":w}` (equiv radius = width / 4), or
  `{"kind":"bar","width_mm":w,"thickness_mm":t}` (GMD equiv radius).
- `sense`: `rhcp` or `lhcp` (default `rhcp`); selects the normal or crossed
  loop B connection, and the tool models the connection it delivers (the
  offset loops make the two senses slightly different antennas off-axis).
- `feed`: coax harness scheme. `line` (default): source at the junction across
  loop A, quarter-wave phasing line to loop B, the two ~110 ohm loops paralleled
  to ~50 ohm (the classic ON6WG/F5VIF/K5OE turnstile feed). `balun4`: the
  ON6WG/F5VIF balanced system -- a quarter-wave 100 ohm balanced phasing line
  between the loops (two RG-58 side by side, braids bonded), fed through a
  quarter-wave 100 ohm balanced Q-section and a half-wave 4:1 coax balun
  ([Appendix
  A](http://146970.com/PDFs/Antenna%20Egg%20Beater%20Appendix%20A%20-%20English.pdf),
  courtesy ON6WG/F5VIF). balun4 gives a balanced feed (no feedline common-mode)
  with everyday cable. `choke`: the F5VIF "final" system -- the same balanced
  phasing line, but fed directly through a 1:1 ferrite current choke (a stack
  of ferrite cores over the 50 ohm feed coax) with no Q-section or 4:1 balun,
  so the radio sees the ~50 ohm feedpoint straight through. balun4 and choke
  share the same balanced NEC model and differ only in the match hardware.
- `loop_shape`: `circle` (default), `square`, or `squircle` (a square with
  radiused corners: four straight sides joined by quarter-circle arcs). The
  loop perimeter is held fixed across shapes; the cut sheet reports the across
  dimension as diameter (circle) or side/width (square, squircle) to match.
- `corner_radius_wl`: squircle corner radius in wavelengths (default 0.05;
  ignored for circle and square). Must be below the equivalent circle radius
  (perimeter / 2*pi), past which no straight side remains.
- `reflector`: `none` (free space), `ground` (perfect ground plane), or
  `radials` (finite radial-wire reflector, ON6WG/M2 style).
- `reflector_spacing_wl`: loop-center height above the reflector (default 0.25).
- `radial_*`: count (8), length in wavelengths (0.27), droop in degrees (0).
- `loop_offset_mm`: vertical gap between the loop centers so the equal loops
  clear at the crossings (default 10; must be at least 1.5x the equivalent
  conductor diameter).
- `feed_gap_mm`: feed gap at the bottom of each loop (default 10). A build
  dimension only: reported on the cut sheet but not modeled, since NEC's source
  is already a delta-gap feed (see Modeling caveats).
- `phasing_coax` / `match_coax`: cable for the quarter-wave phasing line and
  the matching transformer. Either a catalog name (`"RG-58"`, `"RG-59"`,
  `"RG-62"`) or a custom cable `{"name": ..., "z0_ohm": ..., "vf": ...}`. The
  phasing line defaults to RG-62 (93 ohm, VF 0.84); the transformer defaults to
  the catalog cable nearest the computed transformer impedance. `phasing_coax`
  applies only to the `line` feed and `match_coax` not to the balanced feeds
  `balun4`/`choke` (the harness feeds fix their own cables); setting them
  elsewhere is an error.
- `system_z_ohm`: radio-end impedance the match targets (default 50; 75 works).
- `ar_margin_db`: axial-ratio headroom **Optimize** seeks below the
  3 dB budget (default 0.5). It biases the spacing/droop placement toward lower
  worst-case cone AR (hence more bandwidth); the radial count is then chosen at
  the knee of the worst-case-AR-versus-count curve -- the fewest radials past
  which adding more buys less than a small AR improvement.
- `segments`: polygon sides per loop (maximum 99). Omit it and the count is
  derived, from two requirements: segment length held at a fixed number of
  conductor radii (so a spec means the same discretization at every band and
  conductor size), and enough sides for the polygon to stay within one conductor
  radius of the intended outline. The second binds only on curved shapes, and
  hardest on the squircle -- its curvature sits in four tight corners while
  segments spread evenly, so a 5 mm conductor at 2 m derives 24 sides for a
  square, 28 for a circle and 48 for a squircle. Set the field to pin a count
  instead. Non-circular shapes resample to equal-length sides; a multiple of 4
  lands a square's corners on vertices.
- `label`: optional name for output; defaults to none.
- `notes`: optional free-text design intent; carried through optimization.
- `optimization`: output-only provenance, written by **Optimize** (the
  input spec and the search parameters). You do not author it; it round-trips so
  an optimized spec records where it came from.

The designer works on one spec at a time. The frozen `designs/` files hold a
list of two specs (one per band), a form the retired CLI accepted; import the
bands separately.

### Actions

- **Analyze** evaluates the literal on-screen geometry without re-tuning, and
  fills the results tabs.
- **Optimize** tunes the loop perimeter to quadrature and searches the reflector
  radial count, spacing, and droop. A spec -> spec transform: it keeps the
  fewest radials that still meet the axial ratio and post-match VSWR objectives
  (for each count, a coordinate descent over spacing and droop finds the lowest-
  cost placement). The chosen geometry replaces the input's, the fields it wrote
  are tagged `opt` in the spec rail, and an `optimization` block records the
  input spec and search parameters.

Results appear across the tabs: the **cut sheet** (physical dimensions and match
hardware), **charts** (frequency-sweep VSWR and axial ratio, with the 2:1 VSWR
and 3 dB axial-ratio bandwidths of the matched antenna), **sky maps**
(azimuth-elevation gain and axial ratio), a **3-D wire model** (drag to orbit,
scroll to zoom), and the **feed and match schematic** (a crossed phasing line is
drawn as an actual conductor swap).

The **Files** tab downloads the resolved spec JSON, the result JSON (the
machine-readable cut sheet: `spec` plus `build` and `performance` sections,
rendered from the same numbers as the text output), and the tuned NEC deck.
`#report` deep-links a print view stamped with the tool version and git hash, so
a bench printout is traceable.

## How it works

The model is two equal resonant loops driven with their currents 90 degrees
apart for circular polarization. With the default `line` feed, a voltage
source drives loop A directly across its feed gap and loop B is fed through a
quarter-wave phasing line (a NEC transmission-line card at the phasing coax's
impedance). Crossing a line's conductors (modelled as a negative Z0) reverses
the handedness. A coarse probe run reads the natural handedness, the requested
`sense` picks the normal or crossed connection, and the design is tuned and
characterized with that delivered connection -- crossing is a mirror image
only on boresight, since the vertical loop offset makes the two senses
slightly different antennas off-axis.

The `balun4` feed is the line feed's model with a 100 ohm balanced phasing
line; its Q-section and balun sit in series toward the radio and do not affect
the loop currents, so they are sized analytically (junction ~50 ohm -> 200 ohm
through the quarter-wave 100 ohm Q-section -> 50 ohm through the 4:1 balun).

The `choke` feed shares that balanced model exactly -- its NEC deck is
identical to `balun4` -- and replaces the Q-section and 4:1 balun with a 1:1
ferrite current choke, so the radio sees the ~50 ohm junction impedance
directly, flat across frequency.

Both baluns are idealizations, not simulated hardware. Neither the 4:1
balun/Q-section nor the ferrite choke is in the electromagnetic model:
`balun4`'s harness is modeled analytically as ideal lossless transmission
lines (capturing the 4:1 transform and its off-band dispersion), and the
`choke` is modeled as a perfect 1:1 pass-through (no transform, no dispersion).
The NEC source is a balanced differential drive, so common-mode current is
assumed fully suppressed for both. Ferrite and coax loss, finite
common-mode choking impedance, and core saturation are not modeled.

Conductor cross-sections are reduced to a NEC equivalent radius; the loop
perimeter is then tuned until the two loop currents sit 90 degrees apart
(quadrature -- the circular-polarization mechanism, and unlike source
reactance a single-rooted objective for every feed scheme), which also
corrects any residual error in that estimate. The small source reactance
remaining at quadrature is absorbed by the match network.

The junction feedpoint impedance depends on the loops and the reflector, so the
cut sheet sizes a match to `system_z_ohm`: a series element (inductor or
capacitor) to cancel any residual feedpoint reactance, then a quarter-wave
transformer (`Z0 = sqrt(system_z * Rin)`) with the suggested coax. The
reactance is tuned out at the feed rather than by resizing the loops, which
would move the axial-ratio optimum.

**Optimize** searches the reflector geometry to drive the feedpoint
resistance toward the transformer's sweet spot (about 112 ohm for 75 ohm coax),
minimizing post-match VSWR while keeping axial ratio under budget. It keeps the
fewest radials that still meet the objectives, since the radial count and the
best spacing/droop are coupled (a sparser screen shifts the optimum), so the
spacing and droop are re-searched for each candidate count.

The frequency sweep behind the charts holds the tuned physical antenna fixed,
sweeps the analysis frequency,
and reports two bandwidths: the band where the matched VSWR stays under 2:1
(impedance bandwidth, with an idealized lossless match) and the band where the
boresight axial ratio stays under 3 dB (the usable circular-polarization
bandwidth, which is the narrower, and usually the binding, limit).

## Example: VHF/UHF satellite pair

A worked 2 m + 70 cm RHCP pair lives in `designs/`. `satellite_pair_circle.input.json`
is the authored intent (bands, conductor, RHCP, radials; its `notes` field
states the objective, and reflector count/spacing/droop are left for the
optimizer). Optimizing it produces `satellite_pair_circle.json`, the optimized spec
carrying its provenance; the rest derive from it.

Each pair keeps one basename in `designs/`: `<name>.input.json` (authored),
`<name>.json` (optimized spec), `<name>.result.json`, `<name>.html`, and for
the circle pair the per-band `.2m.nec`/`.70cm.nec` decks.

**These artifacts are frozen.** They were generated by the retired Python
implementation (`awadateki`), which lived in `src/awadateki/` through commit
`bff907e` and is available in the git history. Nothing regenerates them now.
They remain because they are the worked reference designs the modeling notes
below cite; to explore a variant, load one of the `.json` specs into the web
designer (Files tab) and work from there. Each `designs/*.json` is a *list* of
two specs, one per band -- the old CLI ran a list in one pass, while the web
designer takes one spec at a time, so import the bands separately.

The generated plot pages render directly in a browser (GitHub Pages):

- [circle pair](https://charlieh0tel.github.io/tamago/designs/satellite_pair_circle.html)
- [squircle pair](https://charlieh0tel.github.io/tamago/designs/satellite_pair_squircle.html)
- [balun-fed pair](https://charlieh0tel.github.io/tamago/designs/satellite_pair_balun4.html)

The variants: `satellite_pair_squircle` is the same pair with squircle
(rounded-corner square) loops, for building on a square frame;
`satellite_pair_balun4` is the circle pair fed by the balanced balun harness
(`feed: balun4`). Predicted performance for every pair is in the
`.result.json` files and on the plot pages.

## Building

These notes apply to any eggbeater the tool produces; the per-design dimensions
are in the cut sheet (the Cut sheet tab, or the `build` section of the result
JSON).

- Each loop is a full-wave loop. The two equal loops mount in perpendicular
  vertical planes on a common vertical axis, offset vertically by
  `loop_offset_mm` so they clear at the crossings, fed at the bottom.
- The feedline (through the match network) connects at the junction, directly
  across loop A's feed gap; loop B is fed from the same junction through the
  quarter-wave phasing line (cut to the length on the sheet, which already
  includes the cable's velocity factor).
- A radial reflector sits below the loops, its radials drooping below
  horizontal, with the loop centers a fraction of a wavelength above the hub.
- Cancel the small residual feedpoint reactance with the series element, then
  transform to the system impedance with the quarter-wave coax section (the
  sheet names the cable and gives the VF-scaled length; set `match_coax` to use
  a different cable).
- Sense (RHCP vs LHCP) is set by the phasing-line connection: normal or crossed
  (swap the line's conductors at one end), as called out on the cut sheet.

## Modeling caveats

- The physical feed gap is a build dimension only, not modeled. NEC's source is
  already a delta-gap feed; representing the gap as a short fixed-length wire
  used to stop the loop impedance converging (92% drift over a 7x mesh
  refinement), so the loop is meshed uniformly instead. With that fixed the
  impedance settles within 1% and the two bands of a pair agree within about 1%; see
  [docs/segmentation.md](docs/segmentation.md).
- The loop impedance is mostly set by the reflector height, and quoting one
  number for it is meaningless without that height. It runs 62 to 143 ohm over a
  0.09 wavelength span of spacing, monotonically. So the eggbeater literature's
  "100 ohm per loop" is underdetermined rather than wrong: we get 143 ohm at
  F5VIF's stated 1/8 wavelength of clearance and 99 ohm at about 1/16, and cannot
  honor both of their published numbers at once. It matters because the loop
  current split is |Z_loop| / Z0_phasing exactly, so a 93 ohm phasing line costs
  about 3.7 dB of axial ratio at 143 ohm and 0.6 dB at 100 ohm -- which makes
  reflector height the axial-ratio knob, and is why the optimizer settles near
  0.20 wavelengths where the loops are close to the phasing cable. Absolute
  confidence is still low: a point-fed closed loop is the case NEC-2 handles
  worst, and we have no measurements of our own. The cut sheet reports the split,
  which value it used, and both figures; set `measured_loop_z_ohm` from a bridge
  reading to replace the estimate. See
  [docs/reference-designs.md](docs/reference-designs.md).
- Absolute figures are less trustworthy than comparisons. Systematic model error
  largely cancels when asking "is this placement better than that one", so treat
  the optimizer's rankings as more reliable than the axial ratio or impedance it
  prints.
- The phasing line is a NEC ideal transmission line: lossless, with no shield
  or common-mode current (a real build uses a current balun; see TODO). Its
  off-design phase drift matches a real cable exactly, since physical length
  and in-cable wavelength scale by the same velocity factor.
- The match-network bandwidth assumes an idealized lossless network; treat the
  axial-ratio band as the operational coverage.
- The cone axial ratio the optimizer targets is the worst case over the sampled
  coverage cone, so the placement is driven by the cone edge rather than by an
  average that a good boresight can carry; the cut sheet reports the cone mean
  alongside it. Sampling is unweighted (zenith counted once, no solid-angle
  weighting).
- Patterns are modeled with perfect conductors over a perfect (or simple)
  ground.
- Figures of merit are sampled over one azimuth quadrant (phi 0-90 deg), which
  assumes 90 degree symmetry. The crossed loops have it; an odd radial count
  (e.g. 3) does not, so confirm the azimuth ripple over a full sweep before
  committing to one. (A spot check on the 3-radial satellite pair found the
  effect benign near zenith.)

## Development

Everything lives in `web/` (Node 20+):

```
cd web
npm ci
npm run dev     # Vite dev server
npm test        # Vitest
npm run lint    # Biome (lint + format)
npm run build   # typecheck + build into ../prebuilts/app
```

The app is deployed to <https://charlieh0tel.github.io/tamago/> from the
committed bundle in `prebuilts/app/`, so rebuild and commit it when changing the
app -- CI enforces that the bundle matches `web/src`. The UX design is in
`docs/web-ux.md` and the engine's own notes are in `web/README.md`.

The solver and the NEC deck handling are separate packages, in
[charlieh0tel/nec2-js](https://github.com/charlieh0tel/nec2-js): `nec2c-wasm`
is nec2c compiled to WebAssembly, and `nec2c-deck` writes NEC decks and parses
nec2c output. They started here and moved out once they were general enough to
stand on their own.

The project was originally a Python CLI (`awadateki`), retired at commit
`bff907e` once the TypeScript engine reached parity with it. The goldens in
`web/goldens/` are that implementation's output and remain the port's reference.

## License

GNU General Public License v3.0 or later (GPLv3+); see `LICENSE`.
