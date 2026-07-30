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
| 2 m loop impedance | 100 ohm (stated) | 142.8 ohm | +43% |
| 2 m SWR | 1.1 (measured) | 1.19 | +0.09 |
| 2 m loop perimeter | 2112.6 mm | 2165.5 mm | +2.5% |
| 70 cm loop impedance | 100 ohm (stated) | 142.5 ohm | +43% |
| 70 cm SWR at 435 MHz | 1.0 (measured) | 1.22 | +0.22 |
| 70 cm loop perimeter | 704 mm | 730.1 mm | +3.7% |

**The two bands now agree with each other to 0.2%** (142.8 and 142.5 ohm). They
were 41% apart until the feed-region bug was fixed; see
[segmentation.md](segmentation.md). Self-consistency across bands is what makes
the numbers arguable at all, and it is the main thing that changed.

**We disagree with their stated 100 ohm per loop, by about 43%.** This is worth
stating carefully, because an earlier version of this file reported close
agreement (101.0 ohm against 100). That agreement was an artifact: the unfixed
model's loop impedance drifted with the mesh and happened to pass through 100 ohm
near 24 segments, which is also where the mesh calibration had pinned it. With
the mesh converged the model says ~143 ohm at any count.

Which is right is open. Two considerations:

- Their 100 ohm reads like a design idealization -- the sentence is "each of the
  two loops has an impedance of 100 ohms, and when coupled in parallel, they
  offer an ideal 50 ohms impedance", which is the argument for the 50 ohm result
  rather than a reported measurement. Their measured datum is SWR.
- On that measured datum we are closer but still off: 1.19 and 1.22 against their
  1.1 and 1.0. Our isolated single loop converges to ~126 ohm in free space,
  which is inside the textbook 100-130 ohm band for a full-wave loop; the
  reflector at 0.29 wavelengths then raises it.

So the honest position is that the model is now internally consistent and lands
above their stated loop impedance, and the discrepancy needs an explanation
rather than a calibration.

**Loop perimeter runs 2.5 to 3.7% long** in both bands. Part of that is expected,
since they size for *resonance* while we solve for *quadrature between the
loops*, which is a different condition. The rest is unexplained.

**Not a disagreement -- RG-62 velocity factor.** F5VIF uses 0.86; we use 0.84,
which is the Belden 9269 (RG-62A/U) datasheet figure for velocity of
propagation. Their 44.5 cm cut length only reproduces with 0.86; ours prints
43.4 cm. Both values are defensible published figures for the same cable type,
so this is a source discrepancy rather than an error on either side. A builder
should trim to measurement regardless.
