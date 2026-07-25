// Design constants ported from src/awadateki/design.py.
//
// This module carries the scalar constants and enumerated names that the ported
// modules (spec serialization, geometry validation) need. The design core
// itself (tuning, harness synthesis, metrics, optimizer) is a later wave; only
// the constants it will share live here now.

import { RG_58, RG_58_BALANCED, RG_59, RG_62 } from "./coax";

// Reflector schemes.
export const REFLECTOR_NONE = "none";
export const REFLECTOR_GROUND = "ground";
export const REFLECTOR_RADIALS = "radials";

// Polarization senses.
export const SENSE_RHCP = "rhcp";
export const SENSE_LHCP = "lhcp";

// Feed schemes: how the radio drives the two loops.
export const FEED_LINE = "line"; // source at the junction across loop A; 1/4-wave line to B
export const FEED_TURNSTILE = "turnstile"; // per-loop Q-sections joined in parallel
// The ON6WG/F5VIF "balanced system": a 100 ohm balanced phasing line between the
// loops, fed at the junction through a 100 ohm balanced Q-section and a
// half-wave 4:1 coax balun.
export const FEED_BALUN4 = "balun4";
export const FEEDS = [FEED_LINE, FEED_TURNSTILE, FEED_BALUN4] as const;

// Quarter-wave sections (phasing line, Q-sections, delay line): NEC ideal TLs of
// this electrical length (free-space wavelengths) give 90 deg each.
export const PHASING_LINE_WL = 0.25;
export const BALUN_LINE_WL = 0.5;

// Default phasing-line cable for the line feed (spec.phasingCoax overrides).
export const LINE_PHASING_COAX = RG_62;
// Harness cables per scheme (catalog defaults).
export const TURNSTILE_Q_COAX = RG_59;
export const TURNSTILE_DELAY_COAX = RG_58;
export const BALUN4_PHASING_COAX = RG_58_BALANCED;
export const BALUN4_Q_COAX = RG_58_BALANCED;
export const BALUN4_BALUN_COAX = RG_58;

// Port wires hosting harness junctions (a NEC TL port must be a wire segment).
export const PORT_TAG_BASE = 400;

// The loop offset must give the crossing conductors at least this many
// equivalent conductor diameters of axis separation (1.0 = surfaces touching).
export const MIN_LOOP_OFFSET_DIAMETERS = 1.5;
// NEC tag bases (100/200/300/400) are 100 apart and the feed-gap split adds two
// wires per loop, so past this many polygon sides loop A's tags would collide
// with loop B's and the phasing line would bind to the wrong wire.
export const MAX_SEGMENTS = 98;
export const REFERENCE_IMPEDANCE_OHMS = 50.0;
export const HZ_PER_MHZ = 1.0e6;

// Default spec.arMarginDb: margin the reflector optimizer holds below the
// axial-ratio budget at band center.
export const AR_MARGIN_DB = 0.5;
export const AR_TARGET_DB = 3.0;

// Residual feedpoint reactance above which a series tuning element is sized.
export const MATCH_REACTANCE_WARN_OHMS = 10.0;

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
// Post-match VSWR a radial count must meet to be kept feasible.
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
