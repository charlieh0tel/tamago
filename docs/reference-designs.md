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

**We disagree with their stated 100 ohm per loop, by about 43% -- and the
disagreement appears to be theirs.** An earlier version of this file reported
close agreement (101.0 ohm against 100). That was an artifact: the unfixed
model's loop impedance drifted with the mesh and happened to pass through 100 ohm
near 24 segments, which is also where the mesh calibration had pinned it. With
the mesh converged we say ~143 ohm at any count.

Three things point toward the ~143 ohm, though none of them is decisive, and the
first is weaker than it looks:

- **Independent NEC modeling agrees with us -- but it is the same method.** This
  is agreement with our *implementation*, not corroboration of the *physics*: if
  NEC-2 is systematically off for a point-fed closed loop, both models share the
  error. Treat it as a code check, not a validation. For resonant full-wave loops in
  free space (#12 wire at 18 MHz), <https://practicalantennas.com/theory/loop/full-wave/>
  reports 121 ohm (triangle, corner fed), 126 (square, side fed), 129 (square,
  corner fed) and 134 (hexagon, corner fed) -- rising with side count.
  Extrapolating that trend to a circle lands close to our 143 ohm. Our own
  isolated single loop, converged, resonates at about 1.07 wavelengths of
  perimeter with R = 143 ohm.
- **That source names this exact belief as an error**: "the perimeter of a loop is
  not a fixed constant for a particular resonant frequency, and ... all full wave
  loops do not have the same feedpoint impedance. These are common
  misconceptions." A single "100 ohms" for any full-wave loop is the
  misconception; F5VIF uses it to motivate "two in parallel give 50 ohms", which
  is an argument rather than a measurement. Against that: whatever its provenance,
  the amateur figure may descend from people putting a bridge across a real loop,
  and a measurement beats any number of NEC runs.
- **Their SWR figure is not a calibrated measurement.** They write: "A SWR of 1.0
  means that there was no deflection of the needle on the SWR meter." A reading
  below a VHF meter's resolution is compatible with the 1.18 to 1.22 we predict,
  so it does not discriminate.

**So this is not settled, and an earlier version of this file said it was.** What
we have is one method agreeing with itself. A point-fed closed loop is exactly the
case NEC-2 handles worst -- we spent a long investigation watching one
feed-modeling choice move the same number by 92% -- so its absolute value here
deserves little confidence. The relation that uses it (balance = |Z_loop| / Z0) is
transmission-line theory and is not in doubt; only the impedance is.

That is why `measured_loop_z_ohm` exists: put a bridge across one loop and the
tool will use the reading instead, and the cut sheet reports which it used. Until
someone does, the cut sheet also shows what the axial ratio would be at the
literature's 100 ohm, since the difference (about 3.7 dB against 0.6 dB) changes
the conclusion entirely.

It also confirms our resonant perimeter: "larger diameter conductors require a
larger circumference for resonance", which is why our loops resonate longer than
the 1005/F starting length. F5VIF build long and trim ("shortening is easier then
lengthening"), so their finished loops are not 1.0215 wavelengths either.

**If the impedance holds up, the consequence is a real design finding.** If the
loops really are ~143 ohm, then the classic 93 ohm RG-62 phasing line splits the
loop currents 1.5:1, and that imbalance alone sets about 3.7 dB of axial ratio --
which is consistent with the eggbeater's reputation as a serviceable rather than
high-purity circular antenna. Equal drive would want a phasing line near the loop
impedance; nothing in our catalog is close (the highest is the 100 ohm bonded
pair), which is worth noting for anyone chasing better axial ratio. The cut sheet
now reports this split explicitly.

**Loop perimeter runs 2.5 to 3.7% long** in both bands. Part of that is expected,
since they size for *resonance* while we solve for *quadrature between the
loops*, which is a different condition. The rest is unexplained.

**Not a disagreement -- RG-62 velocity factor.** F5VIF uses 0.86; we use 0.84,
which is the Belden 9269 (RG-62A/U) datasheet figure for velocity of
propagation. Their 44.5 cm cut length only reproduces with 0.86; ours prints
43.4 cm. Both values are defensible published figures for the same cable type,
so this is a source discrepancy rather than an error on either side. A builder
should trim to measurement regardless.
