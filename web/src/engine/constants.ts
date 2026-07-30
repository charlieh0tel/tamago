// Design constants ported from src/awadateki/design.py.
//
// This module carries the scalar constants and enumerated names that the ported
// modules (spec serialization, geometry validation) need. The design core
// itself (tuning, harness synthesis, metrics, optimizer) is a later wave; only
// the constants it will share live here now.

import { RG_58, RG_58_BALANCED, RG_62 } from "./coax";

// Reflector schemes.
export const REFLECTOR_NONE = "none";
export const REFLECTOR_GROUND = "ground";
export const REFLECTOR_RADIALS = "radials";

// Polarization senses.
export const SENSE_RHCP = "rhcp";
export const SENSE_LHCP = "lhcp";

// Feed schemes: how the radio drives the two loops.
export const FEED_LINE = "line"; // source at the junction across loop A; 1/4-wave line to B
// The ON6WG/F5VIF "balanced system": a 100 ohm balanced phasing line between the
// loops, fed at the junction through a 100 ohm balanced Q-section and a
// half-wave 4:1 coax balun.
export const FEED_BALUN4 = "balun4";
// The F5VIF "final" balanced system: the same 100 ohm balanced phasing line, but
// fed through a 1:1 ferrite current choke (no Q-section, no 4:1 balun); the radio
// sees the feed Z directly.
//
// Idealization: the choke is NOT in the NEC model (the deck is identical to
// balun4). It is treated as a perfect 1:1 pass-through -- the radio sees the
// junction impedance directly, flat across frequency. What that ignores, and
// what balun4's analytic harness model also ignores, is real hardware physics:
// ferrite and coax loss, finite/frequency-dependent common-mode choking
// impedance, and core saturation. The NEC source is a balanced differential
// drive, so common-mode current is assumed fully suppressed for both feeds.
export const FEED_CHOKE = "choke";
export const FEEDS = [FEED_LINE, FEED_BALUN4, FEED_CHOKE] as const;
// Feeds built on the balanced phasing-line NEC model.
export const BALANCED_FEEDS = [FEED_BALUN4, FEED_CHOKE] as const;
export function isBalancedFeed(feed: string): boolean {
  return (BALANCED_FEEDS as readonly string[]).includes(feed);
}

// Quarter-wave sections (phasing line, Q-sections): NEC ideal TLs of this
// electrical length (free-space wavelengths) give 90 deg each.
export const PHASING_LINE_WL = 0.25;
export const BALUN_LINE_WL = 0.5;

// Default phasing-line cable for the line feed (spec.phasingCoax overrides).
export const LINE_PHASING_COAX = RG_62;
// Balun4 harness cables (catalog defaults).
export const BALUN4_PHASING_COAX = RG_58_BALANCED;
export const BALUN4_Q_COAX = RG_58_BALANCED;
export const BALUN4_BALUN_COAX = RG_58;
// Choke harness: same balanced phasing line, a 50 ohm feed coax carrying the
// ferrite cores of the 1:1 current choke.
export const CHOKE_PHASING_COAX = RG_58_BALANCED;
export const CHOKE_FEED_COAX = RG_58;
export const CHOKE_FERRITE_CORES = 3;
// Ferrite mix by band: 43 mix (VHF) below the threshold, 61 mix (UHF) at or above.
export const CHOKE_CORE_PN_VHF = "Fair-Rite 2643540002";
export const CHOKE_CORE_PN_UHF = "Fair-Rite 2661540002";
export const CHOKE_UHF_THRESHOLD_MHZ = 300.0;

// Port wires hosting harness junctions (a NEC TL port must be a wire segment).
export const PORT_TAG_BASE = 400;

// The loop offset must give the crossing conductors at least this many
// equivalent conductor diameters of axis separation (1.0 = surfaces touching).
export const MIN_LOOP_OFFSET_DIAMETERS = 1.5;
// NEC tag bases (100/200/300/400) are 100 apart and each polygon side takes one
// tag, so past this many sides loop A's tags would collide with loop B's and the
// phasing line would bind to the wrong wire.
export const MAX_SEGMENTS = 99;

// Loop mesh density, used when spec.segments is null.
//
// NEC wants segments short compared with the wavelength (to resolve the current)
// but long compared with the conductor radius (the thin-wire kernel). A loop is
// about one wavelength around at every band, so a fixed segment count already
// holds the first roughly constant -- but it lets the second vary with the
// conductor, by more than a factor of two between the bands of one pair. That is
// what made two halves of a pair incomparable at equal `segments`, so the count
// is derived from the conductor radius instead, holding the binding ratio fixed.
//
// 36 radii reproduces the one design point checked against published hardware
// (the ON6WG/F5VIF 2 m build; see docs/reference-designs.md). It is a
// calibration, not a convergence result -- see docs/segmentation.md.
export const LOOP_SEGMENT_RADII = 36.0;
// Rounded to a multiple of this so a square loop's corners land on vertices.
export const LOOP_SEGMENT_QUANTUM = 4;
// A polygon this coarse barely resembles a circle, so the derived count stops
// here even for conductors thick enough to ask for fewer.
export const MIN_LOOP_SEGMENTS = 12;
// Segment lengths above this fraction of a wavelength under-resolve the loop
// current; reported as a warning rather than enforced, since a thick conductor
// cannot satisfy both this and LOOP_SEGMENT_RADII at once.
export const LOOP_SEGMENT_WL_WARN = 0.1;
export const REFERENCE_IMPEDANCE_OHMS = 50.0;
export const HZ_PER_MHZ = 1.0e6;

// Default spec.arMarginDb: margin the reflector optimizer holds below the
// axial-ratio budget at band center.
export const AR_MARGIN_DB = 0.5;
export const AR_TARGET_DB = 3.0;

// Residual feedpoint reactance above which a series tuning element is sized.
export const MATCH_REACTANCE_WARN_OHMS = 10.0;
// The quarter-wave match must beat a direct connection by at least this much
// VSWR to be worth specifying; below it the section is inert (see
// matchIsUseful) and the cut sheet says to connect the feedline directly.
export const MATCH_VSWR_MARGIN = 0.02;

// Target NEC segment length along a radial, in wavelengths.
export const RADIAL_SEGMENT_WL = 0.05;

// Port wires: geometry of the tiny isolated segments hosting harness junctions.
export const PORT_SEGMENT_LENGTH_M = 0.002;
export const PORT_RADIUS_M = 0.0005;
export const PORT_SPACING_M = 0.02;

// Solver bounds and convergence controls.
export const FACTOR_BOUNDS: [number, number] = [0.7, 1.4];
// Untuned perimeter factor used by the coarse handedness probe run.
export const SENSE_PROBE_FACTOR = 1.05;
export const SOLVER_MAX_ITERATIONS = 40;
export const PHASE_TOLERANCE_DEG = 0.5;
// Golden-section ratio for the reflector-placement minimization.
export const GOLDEN_RATIO = (Math.sqrt(5.0) - 1.0) / 2.0;

// Axial ratio is optimized and reported over the high-elevation coverage cone.
export const BORESIGHT_THETA_DEG = 30.0;
// Coverage gain is the worst-case gain over the operational cone.
export const COVERAGE_THETA_DEG = 60.0;
// Total gains at or below this level mark pattern nulls and are ignored.
export const NULL_GAIN_DB = -100.0;

// Reflector optimization: continuous search bounds and the axial-ratio budget.
export const SPACING_BOUNDS_WL: [number, number] = [0.15, 0.4];
export const DROOP_BOUNDS_DEG: [number, number] = [0.0, 50.0];
export const SPACING_TOLERANCE_WL = 0.005;
export const DROOP_TOLERANCE_DEG = 1.0;
export const PLACEMENT_SWEEPS = 2;
export const RADIAL_COUNT_GRID: number[] = [3, 4, 6, 8];
// Cost penalty per dB of axial ratio above the margin-tightened budget.
export const AR_PENALTY_PER_DB = 1.0;
// Minimum worst-case cone AR improvement (dB) a larger radial count must buy to
// be worth the extra radials; below it the curve has flattened and the smaller
// count is kept. This is the count-selection knee.
export const AR_KNEE_DB = 0.2;
// Post-match VSWR a placement must hold within to be a valid match.
export const FEASIBLE_VSWR = 1.5;

// Frequency-sweep defaults and the SWR threshold whose bandwidth is reported.
export const SWEEP_SPAN_FRACTION = 0.1;
export const SWEEP_POINTS = 41;
export const VSWR_LIMIT = 2.0;

// Map nec2c's polarization sense column to a handedness constant.
export const NEC_SENSE_TO_HAND: Record<string, string> = {
  RIGHT: SENSE_RHCP,
  LEFT: SENSE_LHCP,
};

// nec2c executable name (runtime only; never serialized).
export const DEFAULT_NEC2C = "nec2c";

// The loop and radial NEC tag bases (LOOP_A_TAG_BASE, LOOP_B_TAG_BASE,
// RADIAL_TAG_BASE) originate in geometry.py and live in geometry.ts; import
// them from there. PORT_TAG_BASE above is the design.py-origin harness base.
