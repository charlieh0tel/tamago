# Segmentation convergence: an open modeling limitation

Status: open (2026-07-29). The loop driving-point impedance this model predicts
does not converge as `segments` increases. Axial ratio is derived from it, so
absolute axial-ratio figures carry several dB of uncertainty, and two designs are
only comparable when their `segments` match.

This note records the measurements and, more usefully, the causes that were
ruled out, so the next attempt does not repeat them.

## The observation

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

## Still suspected

The source region. The feed gap is modeled as a single-segment wire of fixed
length carrying the voltage source, while the loop segments around it shrink as
`segments` grows -- the source-to-neighbour length ratio moves from about 13:1
to 2:1 across the sweep. A NEC applied-field source is sensitive to its segment
geometry, and this is the one part of the model whose relative proportions change
throughout the sweep.

## What would settle it

1. Validate against the published reference designs (ON6WG/F5VIF, K5OE, the
   Houston eggbeater). With no measurements of our own, those field-proven
   geometries are the only external anchor -- and they are the second thing this
   project has needed them for.
2. Pin and justify a segment count rather than treating 16, 36, and 50 as
   interchangeable, and make the goldens use one value.
3. Rework the feed/source construction if the source region is confirmed as the
   cause: a uniformly segmented loop with the source on an ordinary segment
   removes the changing proportion.
