# Published reference designs

This project has no measurements of its own, so field-proven published designs
are its only external anchor. This note records what those designs actually
state, how their conventions map onto our spec fields, and where our model
agrees or disagrees.

Everything under "stated" is quoted from the source. Anything derived from those
numbers is labelled as such.

## ON6WG / F5VIF, "Eggbeater Antenna VHF/UHF, Part 1"

Source: <https://qsl.net/k/kd7tww/Antennas/Antenne%20Eggbeater-Engl-Part1-Full.pdf>
(mirror; the original at 146970.com is HTTP-only). Part 1 is the plain
coax-and-phasing-line build, matching our `line` feed. The balanced phasing
section and balun improvements that our `balun4` and `choke` feeds model are in
Part 2 / Appendix A, not yet retrieved.

### Stated

| item | 2 m | 70 cm |
|---|---|---|
| design frequency used in the formulas | 145 MHz | 435 MHz |
| loop perimeter, from `1005 / F(MHz)` feet | 211.26 cm | 70.4 cm |
| conductor, prototype | flat aluminium rod 10 mm | brass tube 4 mm dia |
| conductor, preliminary test | copper 2 mm dia | copper 2 mm dia |
| phasing line | RG-62 A/U, 93 ohm, VF 0.86, quarter wave | same |
| phasing line cut length | 44.5 cm | 14.8 cm |
| feed coax | 52 ohm | 52 ohm |

Also stated, for both bands:

- "Each of the two loops forming the antenna has an impedance of 100 ohms, and
  when coupled in parallel, they offer an ideal 50 ohms impedance."
- Reflector: "at least 8 quarter wavelength radials".
- "Distance between loops and reflector : 1/8 wavelength (best result issued by
  4nec2)."
- Measured SWR, 70 cm: 1.3 / 1.2 / 1.0 / 1.0 / 1.1 / 1.2 / 1.3 at 430 / 432 /
  435 / 436 / 437 / 438 / 440 MHz. On 2 m: 1.1 across 144-146 MHz.

Not stated: feed gap, radial droop, loop offset (the crossing clearance).

### Derived

- The loop perimeter formula gives **1.0215 wavelengths** at both bands
  (211.26 cm / 206.75 cm and 70.4 cm / 68.92 cm), so the design is uniformly a
  2.15% oversize full-wave loop.
- Loop radius is therefore 0.1626 wavelengths.

## Reconciling the reflector spacing convention

F5VIF's "1/8 wavelength" **cannot** be a loop-centre height: with a loop radius
of 0.1626 wavelengths, a centre at 0.125 would put the bottom of the loop
0.038 wavelengths *below* the reflector, which our geometry guard rejects
outright (see `DesignInfeasible`). Their construction figures show the radials
well below the loops, so the 1/8 wavelength is measured from the **bottom of the
loops** to the reflector plane.

Our `reflector_spacing_wl` is the **loop-centre** height. Converting:

    centre height = 1/8 + loop radius + loop_offset/2
                  = 0.125 + 0.1626 + ~0.0024
                  ~= 0.29 wavelengths

Two things follow:

- The F5VIF design sits at about **0.29 wavelengths** in our convention, not
  0.125. It is inside our search bounds and slightly above our 0.25 default.
- Their convention is the one a builder can actually measure -- you put a tape
  from the reflector to the bottom of the loops -- while ours is referenced to a
  point in mid air whose height also moves when the perimeter is tuned. Worth
  considering reporting the loop-bottom clearance in the cut sheet.

## Where our model agrees and disagrees

Running `designs/f5vif_reference.input.json` (their geometry, mesh derived from
the conductor) against their published figures:

| quantity | F5VIF | ours | |
|---|---|---|---|
| 2 m loop impedance | 100 ohm (stated) | 101.0 ohm | agrees |
| 2 m SWR | 1.1 (measured) | 1.09 | agrees |
| 2 m loop perimeter | 2112.6 mm | 2165.5 mm | +2.5% |
| 70 cm loop impedance | 100 ohm (stated) | 115.4 ohm | +15% |
| 70 cm SWR at 435 MHz | 1.0 (measured) | 1.13 | +0.13 |
| 70 cm loop perimeter | 704 mm | 730.1 mm | +3.7% |

**2 m validates.** Loop impedance 101.0 against their stated 100, and SWR 1.09
against their measured 1.1. This is the first time anything in this project has
been checked against real hardware, and on this band it holds.

**70 cm is within 15%, after a fix this comparison prompted.** It originally
missed by 41% (141.5 ohm, SWR 1.21). Both bands were running at the same
`segments`, but a raw segment count is not a band-independent mesh: what NEC
cares about is segment length relative to the conductor radius, and their two
prototypes use electrically different conductors.

| | conductor equivalent radius | segment length / radius |
|---|---|---|
| 2 m, 10 mm flat rod | 0.0012 wavelengths | ~36 |
| 70 cm, 4 mm tube | 0.0029 wavelengths | ~15 |

The 70 cm model therefore sat much further along the divergence curve described
in [segmentation.md](segmentation.md) -- where finer effective meshing drives the
loop impedance up -- which is exactly the direction and magnitude of the original
141.5 ohm result. `spec.segments` is now derived from the conductor radius so the
binding ratio, rather than the count, is what a spec holds fixed; that took the
70 cm error from 41% to 15%. The remaining gap is the underlying
non-convergence.

Their 70 cm prototype also cannot satisfy both mesh bounds at any count -- 4 mm
tube at 435 MHz is electrically thick -- so its cut sheet carries a mesh warning.

**Loop perimeter runs 2.5 to 3.7% long** in both bands. Part of that is expected,
since they size for *resonance* while we solve for *quadrature between the
loops*, which is a different condition. The rest is unexplained and worth
understanding; that much loop length matters for a resonant structure.

**Not a disagreement -- RG-62 velocity factor.** F5VIF uses 0.86; we use 0.84,
which is the Belden 9269 (RG-62A/U) datasheet figure for velocity of
propagation. Their 44.5 cm cut length only reproduces with 0.86; ours prints
43.4 cm. Both values are defensible published figures for the same cable type,
so this is a source discrepancy rather than an error on either side. A builder
should trim to measurement regardless.
