# Segmentation convergence: found and fixed

Status: resolved (2026-07-30). The loop driving-point impedance used not to
converge as `segments` rose, which put several dB of uncertainty on every axial
ratio and made two designs incomparable unless their `segments` matched.

The cause was the feed gap: it was modeled as a short wire of fixed length
carrying the source, so the source segment stayed 10 mm while its neighbours
shrank with the segment count. NEC's applied-field source is sensitive to the
segment geometry at the feed, and that growing length discontinuity moved the
answer the whole way. The gap is no longer modeled -- NEC's source already is a
delta-gap feed -- and the loop is meshed uniformly.

This note keeps the measurements, the causes that were ruled out along the way,
and the decisive experiment, because the ruled-out list is what stopped the
search going in circles.

## The decisive experiment

One full-wave loop in free space, no crossed pair, no reflector, no
transmission line, fed two ways as the mesh is refined:

| segments | source on an ordinary segment | source on a fixed 10 mm gap wire |
|---------:|------------------------------:|---------------------------------:|
| 12 | 128.4 -88.8j | 67.9 -51.5j |
| 16 | 128.0 -77.5j | 75.7 -49.8j |
| 24 | 127.4 -69.6j | 87.5 -51.1j |
| 32 | 127.0 -66.8j | 96.7 -53.8j |
| 48 | 126.4 -65.1j | 110.8 -59.5j |
| 64 | 126.0 -64.6j | 121.7 -64.5j |
| 80 | 125.7 -64.4j | 130.4 -68.7j |

The uniform mesh settles within 2% across a 7x refinement, in the textbook
100-130 ohm band for a one-wavelength loop. The gapped model swings 92% and
crosses the right answer around 64 segments rather than converging to it.

In the full eggbeater the fix takes the drift over `segments` 16 to 96 from 14%
to 0.7% on the junction impedance, and from 79% to 1.2% on loop balance.

## The observation, before the fix

Perimeter held fixed at 1.05 wavelengths (no quadrature re-tune), free space,
5 mm round conductor, `line` feed. Only the segment count varies:

| segments | z_in (junction) | loop balance |
|---------:|----------------:|-------------:|
| 16 | 48.3 -1.3j | 0.916 |
| 24 | 47.7 +0.5j | 1.045 |
| 36 | 46.7 +1.7j | 1.196 |
| 50 | 45.3 +2.4j | 1.333 |
| 72 | 43.5 +3.1j | 1.498 |
| 96 | 41.8 +3.5j | 1.638 |

The drift is monotone with no sign of flattening across a six-fold range. With
the quadrature tune enabled the same sweep moves the loop impedance from about
81 to 145 ohms and coverage gain by nearly 4 dB.

## Why it matters more than it looks

For a quarter-wave phasing line the loop current balance is exactly

    balance = |Z_loop| / Z0_phasing

(verified to three decimals against the model), and axial ratio on axis follows
`20*log10(balance)`. So a drifting loop impedance feeds straight into the
headline axial-ratio number: the sweep above spans roughly 1.7 to 4 dB of
predicted cone axial ratio from segmentation alone.

Practical consequences:

- The goldens are generated at `segments` 16 and 36; those cases describe
  measurably different antennas, not the same antenna at two resolutions.
- The library default is 36. The loop impedance passes through the textbook
  100-130 ohm band for a full-wave loop somewhere around 24 to 50 segments, so
  36 may be reasonable by luck rather than by convergence.
- Any refinement smaller than a few dB -- choosing the phasing cable from the
  loop impedance, or solving the matching-section length -- is inside this error
  bar and cannot be validated by the model alone.

## Ruled out

Each of these was tested and is *not* the cause:

- **The quadrature re-tune.** Holding the perimeter fixed (the table above)
  still diverges, so the tuning feedback loop is not responsible.
- **Thin-wire kernel violation.** NEC wants segment length well above the wire
  radius. Repeating the sweep with a 1 mm conductor keeps that ratio between 270
  and 45 -- comfortably valid throughout -- and balance still runs 1.117 to
  1.571.
- **Loop-crossing coupling.** Changing `loop_offset_mm` from 10 to 240 mm leaves
  the tuned factor, loop impedance, and balance identical to five digits. This
  is correct physics rather than a bug: the two loops are orthogonal, so their
  mutual impedance is essentially zero. The offset moves the phase centers and
  therefore the far field (cone axial ratio went 4.8 to 7.9 dB), but not the
  feed-point quantities.
- **Polygon approximation of the circle.** At fixed perimeter a finer polygon
  encloses slightly more area, so the circle's geometry does change with
  `segments`. A square loop with `segments` divisible by four is geometrically
  exact at every count -- extra segments only subdivide the sides -- and it
  diverges too (z_in 75.3 to 46.7 ohms, balance 1.22 to 1.60 over 16 to 96
  segments). The effect is therefore numerical, not geometric.
- **Feed-gap to segment-length ratio.** Scaling `feed_gap_mm` to hold the ratio
  constant across segment counts does not converge either.

## Confirmed cause

The source region, as suspected. The feed gap was a single-segment wire of fixed
length carrying the voltage source while the loop segments around it shrank with
`segments`, taking the source-to-neighbour length ratio from about 13:1 to 2:1
across the sweep. That was the only part of the model whose proportions changed
throughout, and removing it removes the divergence.

## `segments` was also the wrong normalization

Before the cause was found, the F5VIF reference exposed a sharper symptom: at the
*same* `segments` the model reproduced their stated 100 ohm on 2 m (101.0 ohm)
and missed by 41% on 70 cm (141.5 ohm), because their two prototypes use
electrically different conductors:

| | conductor equivalent radius | segment length / radius |
|---|---|---|
| 2 m, 10 mm flat rod | 0.0012 wavelengths | ~36 |
| 70 cm, 4 mm tube | 0.0029 wavelengths | ~15 |

A fixed count let that ratio vary by more than 2x between the bands of one pair,
placing them at different points on the divergence curve. So `spec.segments`
defaults to None and is derived from the conductor radius (`loop_segments`),
holding the ratio fixed rather than the count; an explicit integer still
overrides, which is what the goldens use.

That was a mitigation, not the cure -- it narrowed the 70 cm gap from 41% to 15%
without removing the drift. Fixing the feed region removed it outright: the two
bands now agree within 0.2% at whatever mesh they are given. The derivation is
still worth keeping so a spec means the same discretization everywhere, but
`LOOP_SEGMENT_RADII` no longer has to carry the accuracy of the model on its own.

The cut sheet reports the mesh and both validity ratios, flagged when out of
range, so a design carries its own caveat. The F5VIF 70 cm case still warns: at
12 sides its segments are 31 radii (under the 36 target) and 0.089 wavelengths
(near the 0.10 ceiling). A 4 mm tube at 435 MHz cannot satisfy both bounds at any
count -- a real limit, now visible rather than silent.

## What the fix changed downstream

With the mesh converged the model is self-consistent across bands: the two
halves of the F5VIF reference now land within 0.2% of each other (142.8 and
142.5 ohm) where they were 41% apart. That is the point of the exercise.

It also moved us away from F5VIF's stated 100 ohm per loop, to about 143 ohm.
The previous close agreement came from the buggy mesh happening to pass through
100 ohm near 24 segments; it was coincidence, and the `LOOP_SEGMENT_RADII`
calibration that pinned us there was compensating the bug. See
[reference-designs.md](reference-designs.md) for what to make of the
discrepancy.

## What is still open

1. ~~Re-purpose the mesh derivation.~~ Done. The derived count now carries a
   geometric floor as well as the conductor-radius preference: the polygon has to
   stay within one conductor radius of the intended outline
   (`LOOP_SAGITTA_RADII`). That is free now that refining does not move the answer
   -- at the F5VIF 2 m geometry the loop impedance shifts 0.3% between 20 and 40
   sides. It gives, for a 5 mm conductor at 2 m: square 24 sides, circle 28,
   squircle 48. The squircle needs the most, not the least, because its curvature
   is concentrated in four tight corners while segments are spread evenly along
   the perimeter, so the corners receive under a third of them. The thin-wire
   flag also moved off the old calibration value (36 radii) onto a real validity
   limit (`LOOP_SEGMENT_RADII_WARN`, 20), so it stops firing on meshes that are
   simply fine.
2. **Reconcile ~143 ohm against their stated 100 ohm.** Independent NEC modeling
   puts resonant full-wave loops at 121-134 ohm for triangle through hexagon,
   rising with side count, so a circle near 143 ohm is in line -- but that is the
   same method agreeing with itself, not corroboration of the physics, and a
   point-fed closed loop is the case NEC-2 handles worst. A bridge reading would
   settle it; `measured_loop_z_ohm` takes one. See
   [reference-designs.md](reference-designs.md).
3. Validate against more published designs (K5OE, the Houston eggbeater). One
   design is a thin anchor.
