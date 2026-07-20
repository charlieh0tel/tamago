# TODO

Optional work; nothing here blocks the current deliverable (JSON-driven
tool, quarter-wave line phasing via TL card, round/bar conductor, reflector
optimizer with provenance, 4-chart HTML page, cut sheets, bandwidth sweeps,
tuned NEC decks, design doc, tests passing).

## From the adversarial review (2026-07, confirmed findings)

- [ ] Resonance tuning: the secant accepts the 1.05 seed whenever its
      reactance is inside the 0.5 ohm tolerance (6 of 8 shipped designs sit
      at exactly 1.0500), and for harness feeds the port-reactance null is
      multi-rooted (three zeros in an 8% factor span with quadrature
      58/93/104 deg). Tighten the seed handling and reconsider the tuning
      objective (loop quadrature or loop-terminal resonance instead of port
      reactance).
- [ ] phasing_coax is silently ignored for turnstile and balun4, and
      match_coax for balun4; reject or honor them.

## Optimizer

- [ ] Warn about radial-screen resonances near the operating band. The
      balun4 70 cm design (8 radials) has a narrow radial resonance 2.7%
      above band: peak radial current spikes to 4.4x the loop feed current
      over ~0.3% of frequency, visibly kinking the axial-ratio sweep. It is
      razor-sharp only because conductors are lossless; a real screen would
      blunt and shift it, so one drifting in-band with construction
      tolerances matters. Check the radial/feed current ratio across the
      sweep (or +/-10%) and flag peaks; consider letting the optimizer nudge
      radial_length_wl away from such modes.
- [ ] (low priority) Full-azimuth figures of merit. The FoM grid samples only
      phi 0-90 deg, assuming 90 deg symmetry. Odd radial counts (e.g. 3) break
      it, but a one-time 360 deg check showed the effect is benign near zenith
      (gain ripple < 0.3 dB, AR < 3 dB within 20 deg of zenith; worst-case
      coverage gain matches the quadrant value to 0.1 dB). Only worth adding if a
      worst-case (not average) azimuth metric is wanted.

## Modeling fidelity

- [ ] Phasing-line loss and dispersion. The quarter-wave line is a NEC ideal
      TL card (lossless, dispersionless); model real cable loss.
- [ ] Conductor loss and real ground. NEC runs are perfect-conductor with
      perfect or simple ground.
- [ ] Model the feedline shield and a reflector bonded to it: a vertical wire
      (coax shield exterior / mast) from the junction down to the radial hub,
      bonded there. Today the radials float and no shield exists in the model,
      so shield common-mode and counterpoise effects are invisible. Published
      results favoring > 0.5 lambda reflector spacing may assume a bonded
      reflector; re-run the spacing sweep with this model to test that
      hypothesis.

## Tooling and integrations

- [ ] Investigate NECBOL -- a Python library for building NEC models; assess
      whether to adopt it for deck generation / model building.
- [ ] Investigate nec.opt -- external NEC optimization tooling; compare against
      the built-in coordinate-descent reflector optimizer.
- [ ] Integration with arcanum -- evaluate what integrating with it would mean.
