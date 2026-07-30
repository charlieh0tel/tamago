"""Design orchestration: build geometry, drive nec2c, tune to quadrature.

Two equal resonant loops are driven with their currents 90 deg apart for
circular polarization, by one of three coax feed harnesses (spec.feed): the
source at the junction with a quarter-wave line to loop B (line), or the
ON6WG/F5VIF balanced system -- a 100 ohm balanced phasing line fed either
through a balanced Q-section and half-wave 4:1 balun (balun4) or through a 1:1
ferrite choke (choke). balun4 and choke share the same balanced NEC model and
differ only in the match hardware. Harness lines are NEC TL cards; crossing
loop B's connection (negative Z0) reverses the handedness.
"""

import math
import time
from dataclasses import dataclass, replace

from .coax import RG_58, RG_58_BALANCED, RG_62, Coax, nearest_standard_coax
from .conductor import Conductor
from .geometry import (
    LOOP_A_TAG_BASE,
    LOOP_B_TAG_BASE,
    SHAPE_CIRCLE,
    Wire,
    loop_extent_m,
    loop_radius_m,
    make_eggbeater,
    make_radials,
    wavelength_m,
)
from .nec import (
    DEFAULT_NEC2C,
    NecResult,
    RadiationGrid,
    Source,
    TransmissionLine,
    build_deck,
    run_nec,
)

REFLECTOR_NONE = "none"
REFLECTOR_GROUND = "ground"
REFLECTOR_RADIALS = "radials"
SENSE_RHCP = "rhcp"
SENSE_LHCP = "lhcp"

# Map nec2c's polarization sense column to a handedness constant.
NEC_SENSE_TO_HAND = {"RIGHT": SENSE_RHCP, "LEFT": SENSE_LHCP}

# Target NEC segment length along a radial, in wavelengths.
RADIAL_SEGMENT_WL = 0.05

# Loop mesh density, used when spec.segments is None.
#
# NEC wants segments short compared with the wavelength (to resolve the current)
# but long compared with the conductor radius (the thin-wire kernel). A loop is
# about one wavelength around at every band, so a fixed segment count already
# holds the first roughly constant -- but it lets the second vary with the
# conductor, by more than a factor of two between the bands of one pair. That is
# what made two halves of a pair incomparable at equal `segments`, so the count
# is derived from the conductor radius instead, holding the binding ratio fixed.
#
# 36 radii reproduces the one design point checked against published hardware
# (the ON6WG/F5VIF 2 m build; see docs/reference-designs.md). It is a
# calibration, not a convergence result -- see docs/segmentation.md.
LOOP_SEGMENT_RADII = 36.0
# Rounded to a multiple of this so a square loop's corners land on vertices.
LOOP_SEGMENT_QUANTUM = 4
# A polygon this coarse barely resembles a circle, so the derived count stops
# here even for conductors thick enough to ask for fewer.
MIN_LOOP_SEGMENTS = 12
# Segment lengths above this fraction of a wavelength under-resolve the loop
# current; reported as a warning rather than enforced, since a thick conductor
# cannot satisfy both this and LOOP_SEGMENT_RADII at once.
LOOP_SEGMENT_WL_WARN = 0.10

# Quarter-wave sections (phasing line, Q-sections, delay line): NEC ideal TLs
# of this electrical length (free-space wavelengths) give 90 deg each.
PHASING_LINE_WL = 0.25
BALUN_LINE_WL = 0.5

# Feed schemes: how the radio drives the two loops.
FEED_LINE = "line"  # source at the junction across loop A; 1/4-wave line to B
# The ON6WG/F5VIF "balanced system": a 100 ohm balanced phasing line between
# the loops, fed at the junction through a 100 ohm balanced Q-section and a
# half-wave 4:1 coax balun.
FEED_BALUN4 = "balun4"
# The ON6WG/F5VIF "final" balanced system: the same 100 ohm balanced phasing
# line, but the 4:1 balun + Q-section are replaced by a 1:1 ferrite choke balun
# (ferrite cores over a 50 ohm coax at the feedpoint). The paralleled ~100 ohm
# loops present ~50 ohm directly, so no impedance transformer is needed.
#
# Idealization: the choke is NOT in the NEC model (the deck is identical to
# balun4). It is treated as a perfect 1:1 pass-through -- the radio sees the
# junction impedance directly, flat across frequency. What that ignores, and
# what balun4's analytic harness model also ignores, is real hardware physics:
# ferrite and coax loss, finite/frequency-dependent common-mode choking
# impedance, and core saturation. The NEC source is a balanced differential
# drive, so common-mode current is assumed fully suppressed for both feeds.
FEED_CHOKE = "choke"
FEEDS = (FEED_LINE, FEED_BALUN4, FEED_CHOKE)

# Feeds whose harness is the 100 ohm balanced phasing line (balun4 and choke
# share the same NEC model; they differ only in the match hardware).
BALANCED_FEEDS = (FEED_BALUN4, FEED_CHOKE)

# Default phasing-line cable for the line feed (spec.phasing_coax overrides).
LINE_PHASING_COAX = RG_62
# Balun4 harness cables (catalog defaults).
BALUN4_PHASING_COAX = RG_58_BALANCED
BALUN4_Q_COAX = RG_58_BALANCED
BALUN4_BALUN_COAX = RG_58
# Choke feed: same balanced phasing line, a 50 ohm feed coax, and a 1:1 ferrite
# choke balun of this many cores near the feedpoint (Fair-Rite parts below).
CHOKE_PHASING_COAX = RG_58_BALANCED
CHOKE_FEED_COAX = RG_58
CHOKE_FERRITE_CORES = 3
# Fair-Rite cable-core part numbers F5VIF specifies for the choke balun.
CHOKE_CORE_PN_VHF = "Fair-Rite 2643540002"
CHOKE_CORE_PN_UHF = "Fair-Rite 2661540002"
# Above this frequency the UHF ferrite cores are recommended.
CHOKE_UHF_THRESHOLD_MHZ = 300.0

# The loop offset must give the crossing conductors at least this many
# equivalent conductor diameters of axis separation (1.0 = surfaces touching).
MIN_LOOP_OFFSET_DIAMETERS = 1.5
# NEC tag bases (100/200/300/400) are 100 apart and the feed-gap split adds
# two wires per loop, so past this many polygon sides loop A's tags would
# collide with loop B's and the phasing line would bind to the wrong wire.
MAX_SEGMENTS = 98
REFERENCE_IMPEDANCE_OHMS = 50.0
# Residual feedpoint reactance above which a series tuning element is sized.
MATCH_REACTANCE_WARN_OHMS = 10.0
# The quarter-wave match must beat a direct connection by at least this much
# VSWR to be worth specifying; below it the section is inert (see
# match_is_useful) and the cut sheet says to connect the feedline directly.
MATCH_VSWR_MARGIN = 0.02
HZ_PER_MHZ = 1.0e6

# Upper-hemisphere sampling grid: theta 0..80 deg, phi 0..90 deg.
DEFAULT_GRID = RadiationGrid(
    ntheta=9, nphi=7, theta0=0.0, phi0=0.0, dtheta=10.0, dphi=15.0
)

# Bounds and convergence controls for the solvers.
FACTOR_BOUNDS = (0.70, 1.40)
# Untuned perimeter factor used by the coarse handedness probe run.
SENSE_PROBE_FACTOR = 1.05
SOLVER_MAX_ITERATIONS = 40
PHASE_TOLERANCE_DEG = 0.5
# Golden-section ratio for the reflector-placement minimization.
GOLDEN_RATIO = (math.sqrt(5.0) - 1.0) / 2.0
# Axial ratio is optimized and reported over the high-elevation coverage cone,
# theta <= BORESIGHT_THETA_DEG from zenith (the region that matters for the
# satellite use case), rather than at the raw gain peak.
BORESIGHT_THETA_DEG = 30.0
# Coverage gain is the worst-case gain over the operational cone,
# theta <= COVERAGE_THETA_DEG from zenith (elevation >= 30 deg): the lowest gain
# a pass sees anywhere in the high-elevation sky the reflector is tuned for.
COVERAGE_THETA_DEG = 60.0
# Total gains at or below this level mark pattern nulls and are ignored.
NULL_GAIN_DB = -100.0

# Reflector optimization: continuous search bounds and the axial-ratio budget.
# Spacing is capped at 0.40: a sweep to 0.70 (ground and radials, both bands)
# showed coverage gain falls steadily past ~0.3 and collapses near 0.5, where
# the reflector image nulls the pattern at zenith, with no compensating AR or
# VSWR benefit. Published reports favoring > 0.5 spacing may assume a
# reflector bonded to the coax shield, which this model does not represent
# (see TODO); revisit if that model lands.
SPACING_BOUNDS_WL = (0.15, 0.40)
DROOP_BOUNDS_DEG = (0.0, 50.0)
# Coordinate-descent tolerances (the placement is refined to this resolution).
SPACING_TOLERANCE_WL = 0.005
DROOP_TOLERANCE_DEG = 1.0
# Alternating spacing/droop passes per radial count.
PLACEMENT_SWEEPS = 2
# Radial counts searched, ascending; the optimizer stops at the knee of the
# axial-ratio-vs-count curve (fewer radials is cheaper, lighter, less wind load).
RADIAL_COUNT_GRID = (3, 4, 6, 8)
AR_TARGET_DB = 3.0
# Default spec.ar_margin_db: axial-ratio headroom the placement cost seeks below
# AR_TARGET_DB, biasing spacing/droop toward lower worst-case AR (and bandwidth).
AR_MARGIN_DB = 0.5
# Cost penalty per dB of axial ratio above the margin-tightened budget.
AR_PENALTY_PER_DB = 1.0
# Minimum worst-case cone axial-ratio improvement (dB) a larger radial count
# must buy to be worth the extra radials; below it the curve has flattened and
# the optimizer keeps the smaller count. This is the count-selection knee.
AR_KNEE_DB = 0.2
# Post-match VSWR a placement must hold within to be a valid match.
FEASIBLE_VSWR = 1.5

# Frequency-sweep defaults and the SWR threshold whose bandwidth is reported.
SWEEP_SPAN_FRACTION = 0.10
SWEEP_POINTS = 41
VSWR_LIMIT = 2.0


@dataclass(frozen=True)
class DesignSpec:
    """Inputs that define a design problem.

    Fields:
        freq_mhz: design frequency.
        conductor: conductor cross-section.
        reflector: REFLECTOR_NONE, REFLECTOR_GROUND, or REFLECTOR_RADIALS.
        reflector_spacing_wl: loop-center height above the reflector, wavelengths.
        feed: FEED_LINE (source at the junction, quarter-wave line to loop B),
            FEED_BALUN4 (the ON6WG/F5VIF balanced system: 100 ohm balanced
            phasing line, balanced Q-section, half-wave 4:1 balun), or
            FEED_CHOKE (the F5VIF "final" system: the same balanced phasing
            line, fed through a 1:1 ferrite current choke with no Q-section or
            4:1 balun). balun4 and choke share the same balanced NEC model and
            differ only in the match hardware.
        phasing_coax: cable of the quarter-wave phasing line feeding loop B,
            or None for the scheme default (RG-62). FEED_LINE only; setting
            it for a harness feed is an error, since those harnesses fix
            their own cables. Its z0_ohm drives the NEC TL model; its vf sets
            only the reported physical cut length (the NEC line is an ideal
            electrical quarter wave).
        match_coax: cable of the quarter-wave matching transformer, or None to
            suggest the catalog cable nearest the computed transformer Z0.
            Not applicable to the balanced feeds (balun4 and choke), whose
            harness or choke is the match; setting it there is an error.
        sense: desired polarization, SENSE_RHCP or SENSE_LHCP.
        loop_shape: loop outline, SHAPE_CIRCLE, SHAPE_SQUARE, or SHAPE_SQUIRCLE.
        corner_radius_wl: rounded-corner radius for the squircle shape, in
            wavelengths (ignored for circle and square).
        loop_offset_mm: vertical gap between the two loop centers (loop A below,
            loop B above) so the crossed conductors clear at the top and bottom.
            Must be at least MIN_LOOP_OFFSET_DIAMETERS equivalent conductor
            diameters.
        feed_gap_mm: width of the feed gap at the bottom of each loop, where the
            line connects.
        system_z_ohm: radio-end reference impedance the match targets (50 or 75).
        ar_margin_db: axial-ratio headroom the reflector optimizer's placement
            cost seeks below AR_TARGET_DB, biasing spacing/droop toward lower
            worst-case AR (and thus more usable bandwidth). It shapes each
            placement; the radial count is then chosen at the knee of the
            worst-case-AR-versus-count curve (see AR_KNEE_DB).
        segments: polygon sides per loop (at most MAX_SEGMENTS), or None to
            derive a count that holds the segment length at LOOP_SEGMENT_RADII
            conductor radii, which is what keeps two bands comparable.
        radial_count: number of reflector radials (radials scheme).
        radial_length_wl: length of each radial, wavelengths.
        radial_droop_deg: downward tilt of the radials from horizontal.
        label: optional human-readable name for output (e.g. "2 m").
        notes: optional free-text design intent; carried through optimization.
        optimization: provenance set when the spec came from optimize_reflector
            (the input spec and the search parameters); None otherwise.
        nec2c: nec2c executable name or path.

    Only freq_mhz and conductor are required; every other field has a default
    that serves as the single source of defaults for both the CLI and JSON.
    """

    freq_mhz: float
    conductor: Conductor
    reflector: str = REFLECTOR_NONE
    reflector_spacing_wl: float = 0.25
    feed: str = FEED_LINE
    phasing_coax: Coax | None = None
    match_coax: Coax | None = None
    sense: str = SENSE_RHCP
    loop_shape: str = SHAPE_CIRCLE
    corner_radius_wl: float = 0.05
    loop_offset_mm: float = 10.0
    feed_gap_mm: float = 10.0
    system_z_ohm: float = 50.0
    ar_margin_db: float = AR_MARGIN_DB
    segments: int | None = None
    radial_count: int = 8
    radial_length_wl: float = 0.27
    radial_droop_deg: float = 0.0
    label: str | None = None
    notes: str | None = None
    optimization: "Optimization | None" = None
    nec2c: str = DEFAULT_NEC2C


@dataclass(frozen=True)
class Optimization:
    """Provenance of a spec produced by optimize_reflector.

    Fields:
        input: the spec as received, before optimization.
        method: description of the spacing/droop search method.
        spacing_bounds_wl: (low, high) reflector spacing searched, wavelengths.
        droop_bounds_deg: (low, high) radial droop searched, degrees.
        spacing_tolerance_wl: spacing resolution the descent converged to.
        droop_tolerance_deg: droop resolution the descent converged to.
        sweeps: alternating spacing/droop passes per radial count.
        radial_count_grid: radial counts searched.
        ar_target_db: worst-case cone axial-ratio budget the placement cost
            referenced (penalty above ar_target_db - ar_margin_db).
        ar_margin_db: axial-ratio headroom the placement cost sought below the
            budget (shapes spacing/droop; the count is chosen at the AR knee).
        ar_penalty_per_db: cost penalty per dB of worst-case axial ratio above
            the margin-tightened budget.
        feasible_vswr: post-match VSWR intended as a valid match (the placement
            cost drives spacing/droop toward it).
        objective: short description of what was minimized.
        elapsed_s: wall-clock seconds the search took.
    """

    input: DesignSpec
    method: str
    spacing_bounds_wl: tuple[float, float]
    droop_bounds_deg: tuple[float, float]
    spacing_tolerance_wl: float
    droop_tolerance_deg: float
    sweeps: int
    radial_count_grid: tuple[int, ...]
    ar_target_db: float
    ar_margin_db: float
    ar_penalty_per_db: float
    feasible_vswr: float
    objective: str
    elapsed_s: float


@dataclass(frozen=True)
class DesignResult:
    """Tuned design and its predicted performance.

    Fields:
        spec: the originating DesignSpec.
        base_factor: tuned loop perimeter (currents in quadrature) as a
            multiple of wavelength.
        z_in: predicted feedpoint impedance at the harness source (the
            junction or port), before the match network or balun.
        phase_diff_deg: loop current phase difference (loop A minus loop B),
            wrapped to [-180, 180), for the delivered line connection.
        loop_balance: loop current magnitude ratio |I_B| / |I_A| (1.0 is
            balanced). Equal magnitudes are necessary but not sufficient for
            circular polarization; the axial-ratio figures come from the NEC
            pattern, not from this ratio.
        crossed_phasing_line: whether the phasing line is connected crossed to
            deliver the requested sense (the cut-sheet wiring instruction).
        sense: achieved polarization sense (nec2c vocabulary, e.g. RIGHT).
        ar_boresight_db: mean axial ratio over the high-elevation coverage cone
            (theta <= BORESIGHT_THETA_DEG), dB; 0 is perfect circular.
        ar_cone_worst_db: worst axial ratio over the same cone (dB).
        ar_peak_db: axial ratio at the pattern peak (dB).
        coverage_gain_db: worst-case total gain over the coverage cone
            (theta <= COVERAGE_THETA_DEG), dBi.
        deck: the tuned NEC deck text (with the chosen line connection).
        loop_a_feed_z, loop_b_feed_z: active driving-point impedance at each
            loop's feed gap, with both loops driven in the delivered quadrature
            (mutual coupling included). None unless characterized (the optimizer
            skips this extra run); see _loop_feed_impedances.
    """

    spec: DesignSpec
    base_factor: float
    z_in: complex
    phase_diff_deg: float
    loop_balance: float
    crossed_phasing_line: bool
    sense: str
    ar_boresight_db: float
    ar_cone_worst_db: float
    ar_peak_db: float
    coverage_gain_db: float
    deck: str
    loop_a_feed_z: complex | None = None
    loop_b_feed_z: complex | None = None


def _center_z_m(spec: DesignSpec, wavelength: float, perimeter_m: float) -> float:
    if spec.reflector in (REFLECTOR_GROUND, REFLECTOR_RADIALS):
        # Loop center sits the given spacing above the reflector plane (z = 0).
        return spec.reflector_spacing_wl * wavelength
    # In free space the absolute height is irrelevant; keep the loop above the
    # origin for readable coordinates.
    return loop_radius_m(perimeter_m)


def _reflector_wires(spec: DesignSpec, wavelength: float):
    """Radial reflector wires below the loops, or none for other schemes."""
    if spec.reflector != REFLECTOR_RADIALS:
        return ()
    length_m = spec.radial_length_wl * wavelength
    segments_per_radial = max(1, round(spec.radial_length_wl / RADIAL_SEGMENT_WL))
    return make_radials(
        count=spec.radial_count,
        length_m=length_m,
        hub_z_m=0.0,
        droop_deg=spec.radial_droop_deg,
        conductor_radius_m=spec.conductor.equivalent_radius_m,
        segments_per_radial=segments_per_radial,
    )


def _comment_lines(spec: DesignSpec) -> list[str]:
    return [
        "Eggbeater antenna (crossed full-wave loops)",
        f"freq {spec.freq_mhz:g} MHz, reflector {spec.reflector}",
        f"conductor: {spec.conductor.description}, "
        f"equiv radius {spec.conductor.equivalent_radius_mm:.4g} mm",
    ]


def _feed_wire(loop) -> Wire:
    """The loop's feed wire (the one carrying the source/line connection)."""
    return next(w for w in loop.wires if w.tag == loop.feed_tag)


def _feed(egg, spec: DesignSpec, wavelength: float, flip: bool):
    """Junction source and quarter-wave phasing line for the eggbeater.

    The feed drives loop A directly (1<0 source on its feed gap); loop B is fed
    through a quarter-wave line (TL card). A crossed line (negative Z0) reverses
    it, flipping the polarization handedness with identical performance.
    """
    source = Source(egg.loop_a.feed_tag, egg.loop_a.feed_segment, 1.0, 0.0)
    z0 = phasing_line_coax(spec).z0_ohm
    line = TransmissionLine(
        egg.loop_a.feed_tag,
        egg.loop_a.feed_segment,
        egg.loop_b.feed_tag,
        egg.loop_b.feed_segment,
        -z0 if flip else z0,
        PHASING_LINE_WL * wavelength,
    )
    return (), (source,), (line,)


def loop_segments(spec: DesignSpec) -> int:
    """Polygon sides per loop: the spec's value, or derived from the conductor.

    Derived from the nominal one-wavelength perimeter rather than the tuned one,
    so the mesh does not shift underneath the perimeter solver.
    """
    if spec.segments is not None:
        return spec.segments
    wavelength = wavelength_m(spec.freq_mhz)
    target = LOOP_SEGMENT_RADII * spec.conductor.equivalent_radius_m
    sides = wavelength / target
    quantized = LOOP_SEGMENT_QUANTUM * round(sides / LOOP_SEGMENT_QUANTUM)
    ceiling = LOOP_SEGMENT_QUANTUM * (MAX_SEGMENTS // LOOP_SEGMENT_QUANTUM)
    return max(MIN_LOOP_SEGMENTS, min(ceiling, quantized))


def loop_segment_length_m(spec: DesignSpec, perimeter_m: float) -> float:
    """Length of one loop segment at this perimeter."""
    return perimeter_m / loop_segments(spec)


def phasing_line_coax(spec: DesignSpec) -> Coax:
    """The line feed's phasing cable: the spec override or the default."""
    return spec.phasing_coax or LINE_PHASING_COAX


def _feed_balun4(egg, spec: DesignSpec, wavelength: float, flip: bool):
    """The ON6WG/F5VIF balanced system.

    Like the line feed but with a 100 ohm balanced phasing line (two RG-58
    side by side, braids bonded) between the loops. The junction (~50 ohm
    balanced) is fed through a quarter-wave 100 ohm balanced Q-section (up to
    200 ohm) and a half-wave 4:1 coax balun (back down to the radio); those
    are series elements toward the radio, so they are sized analytically and
    only the phasing line enters the NEC model.
    """
    source = Source(egg.loop_a.feed_tag, egg.loop_a.feed_segment, 1.0, 0.0)
    z0 = BALUN4_PHASING_COAX.z0_ohm
    line = TransmissionLine(
        egg.loop_a.feed_tag,
        egg.loop_a.feed_segment,
        egg.loop_b.feed_tag,
        egg.loop_b.feed_segment,
        -z0 if flip else z0,
        PHASING_LINE_WL * wavelength,
    )
    return (), (source,), (line,)


def _harness(egg, spec: DesignSpec, wavelength: float, flip: bool):
    """Feed harness for the spec's scheme: (port wires, sources, TL cards)."""
    if spec.feed == FEED_LINE:
        return _feed(egg, spec, wavelength, flip)
    if spec.feed in BALANCED_FEEDS:
        # balun4 and choke share the balanced phasing-line NEC model; they
        # differ only in the match hardware, which is outside the model.
        return _feed_balun4(egg, spec, wavelength, flip)
    raise ValueError(f"unknown feed scheme: {spec.feed!r}")


class DesignInfeasible(ValueError):
    """This spec cannot be realized: the geometry is invalid, or the loop
    perimeter cannot be tuned to quadrature within its bounds.

    Distinct from a plain ValueError (a caller mistake) so the reflector
    optimizer can score such a candidate as infeasible and keep searching
    instead of aborting the whole run.
    """


def _eggbeater(spec: DesignSpec, factor: float):
    """Build the crossed-loop geometry for a perimeter factor; returns
    (eggbeater, wavelength)."""
    if spec.segments is not None and spec.segments > MAX_SEGMENTS:
        raise ValueError(
            f"segments {spec.segments} exceeds {MAX_SEGMENTS}; the loop wire"
            " tags would collide with the next NEC tag range"
        )
    if spec.phasing_coax is not None and spec.feed != FEED_LINE:
        raise ValueError(
            f"phasing_coax applies only to the line feed; the {spec.feed!r} "
            "harness fixes its own cables"
        )
    if spec.match_coax is not None and spec.feed in BALANCED_FEEDS:
        raise ValueError(
            f"match_coax does not apply to the {spec.feed!r} feed; it has no "
            "quarter-wave matching transformer"
        )
    min_offset_mm = (
        MIN_LOOP_OFFSET_DIAMETERS * 2.0e3 * spec.conductor.equivalent_radius_m
    )
    if spec.loop_offset_mm < min_offset_mm:
        raise ValueError(
            f"loop_offset_mm {spec.loop_offset_mm:g} is below {min_offset_mm:.1f} "
            f"({MIN_LOOP_OFFSET_DIAMETERS:g}x the equivalent conductor diameter); "
            "the loops would touch or overlap at the crossings"
        )
    wavelength = wavelength_m(spec.freq_mhz)
    perimeter = factor * wavelength
    center_z = _center_z_m(spec, wavelength, perimeter)
    if spec.reflector in (REFLECTOR_GROUND, REFLECTOR_RADIALS):
        # The lower loop must clear the reflector plane. Below that, its wires
        # pass through the ground or the radials and nec2c solves a shorted
        # structure, reporting impossibly high gain rather than an error.
        half_extent = (
            loop_extent_m(
                perimeter, spec.loop_shape, spec.corner_radius_wl * wavelength
            )
            / 2.0
        )
        lowest_z = center_z - spec.loop_offset_mm / 2000.0 - half_extent
        if lowest_z <= 0.0:
            raise DesignInfeasible(
                f"reflector_spacing_wl {spec.reflector_spacing_wl:g} puts the lower "
                f"loop {-lowest_z * 1000.0:.1f} mm below the reflector plane at "
                f"perimeter factor {factor:g}; it needs at least "
                f"{(half_extent + spec.loop_offset_mm / 2000.0) / wavelength:.3f} "
                "wavelengths of spacing to clear"
            )
    egg = make_eggbeater(
        perimeter,
        perimeter,
        center_z,
        spec.conductor.equivalent_radius_m,
        loop_segments(spec),
        spec.loop_shape,
        spec.corner_radius_wl * wavelength,
        spec.loop_offset_mm / 1000.0,
        spec.feed_gap_mm / 1000.0,
    )
    return egg, wavelength


def _build_deck_text(
    spec: DesignSpec,
    factor: float,
    flip: bool,
    run_freq_mhz: float | None,
    grid: RadiationGrid | None,
) -> str:
    egg, wavelength = _eggbeater(spec, factor)
    ports, sources, lines = _harness(egg, spec, wavelength, flip)
    wires = egg.wires + ports + _reflector_wires(spec, wavelength)
    return build_deck(
        _comment_lines(spec),
        wires,
        sources,
        ground=spec.reflector == REFLECTOR_GROUND,
        freq_mhz=run_freq_mhz if run_freq_mhz is not None else spec.freq_mhz,
        grid=grid if grid is not None else DEFAULT_GRID,
        transmission_lines=lines,
    )


def analyze(
    spec: DesignSpec,
    factor: float,
    flip: bool = False,
    run_freq_mhz: float | None = None,
    grid: RadiationGrid | None = None,
) -> tuple[NecResult, str]:
    """Run nec2c once for the given loop perimeter and line connection.

    Geometry and the phasing-line length scale to the design frequency;
    run_freq_mhz overrides only the analysis frequency (the FR card), so the
    fixed physical antenna sweeps across a band and the fixed-length line drifts
    from 90 deg off design (real dispersion). grid overrides the pattern
    sampling. flip crosses the phasing line, reversing the handedness.
    """
    deck = _build_deck_text(spec, factor, flip, run_freq_mhz, grid)
    return run_nec(deck, spec.nec2c), deck


def tuned_geometry(
    result: DesignResult,
) -> tuple[tuple[Wire, ...], tuple[tuple[float, float, float], ...]]:
    """Reconstruct the tuned wire model and the two loop feed points.

    Built from the same geometry call as analyze(), so a 3-D view matches the
    deck without parsing it. Returns the loop and reflector wires and the feed
    points (midpoint of each loop's bottom feed wire), in meters.
    """
    egg, wavelength = _eggbeater(result.spec, result.base_factor)
    wires = egg.wires + _reflector_wires(result.spec, wavelength)
    feeds = tuple(
        ((w.x1 + w.x2) / 2.0, (w.y1 + w.y2) / 2.0, (w.z1 + w.z2) / 2.0)
        for w in (_feed_wire(egg.loop_a), _feed_wire(egg.loop_b))
    )
    return wires, feeds


def _secant(
    func, x0: float, x1: float, bounds, tolerance: float
) -> tuple[float, float]:
    """Bounded secant root find; returns (x, residual at x).

    The residual lets the caller tell a converged root from an iterate that
    merely ran out of steps or pinned against a bound.
    """
    low, high = bounds
    f0 = func(x0)
    f1 = func(x1)
    for _ in range(SOLVER_MAX_ITERATIONS):
        if abs(f1) <= tolerance:
            return x1, f1
        denom = f1 - f0
        if denom == 0.0:
            return x1, f1
        x2 = x1 - f1 * (x1 - x0) / denom
        x2 = min(max(x2, low), high)
        x0, f0 = x1, f1
        x1, f1 = x2, func(x2)
    return x1, f1


def _golden_section_min(func, low: float, high: float, tolerance: float) -> float:
    """Golden-section minimizer of a unimodal scalar function on [low, high]."""
    x1 = high - GOLDEN_RATIO * (high - low)
    x2 = low + GOLDEN_RATIO * (high - low)
    f1, f2 = func(x1), func(x2)
    while high - low > tolerance:
        if f1 < f2:
            high, x2, f2 = x2, x1, f1
            x1 = high - GOLDEN_RATIO * (high - low)
            f1 = func(x1)
        else:
            low, x1, f1 = x1, x2, f2
            x2 = low + GOLDEN_RATIO * (high - low)
            f2 = func(x2)
    return (low + high) / 2.0


def _quadrature_factor(spec: DesignSpec, flip: bool = False) -> float:
    """Perimeter factor putting the loop currents in quadrature.

    The inter-loop phase runs monotonically through +/-90 deg exactly once
    across the factor range for every feed scheme, so quadrature -- the
    circular-polarization mechanism itself -- is a well-posed tuning
    objective. The source reactance, by contrast, can null at several
    electrically distinct factors for the harness feeds, and its null can
    sit far from the axial-ratio optimum; at quadrature the residual source
    reactance stays small and the match network absorbs it.
    """

    def phase_error(factor: float) -> float:
        result, _ = analyze(spec, factor, flip=flip)
        return abs(_phase_difference(result)) - 90.0

    factor, residual = _secant(
        phase_error, 1.0, 1.05, FACTOR_BOUNDS, PHASE_TOLERANCE_DEG
    )
    if abs(residual) > PHASE_TOLERANCE_DEG:
        # Pinning against a factor bound leaves the loops far from quadrature;
        # the pattern is then not circularly polarized at all, so report it
        # rather than returning a plausible-looking result.
        raise DesignInfeasible(
            f"loop currents will not reach quadrature within perimeter factors "
            f"{FACTOR_BOUNDS[0]:g}..{FACTOR_BOUNDS[1]:g}: best phase difference is "
            f"{residual + 90.0:.1f} deg at factor {factor:g}"
        )
    return factor


def _loop_currents(result: NecResult) -> tuple[complex, complex]:
    """Feed-segment currents of loop A and loop B."""
    return result.feed_current(LOOP_A_TAG_BASE), result.feed_current(LOOP_B_TAG_BASE)


def wrap_phase_deg(angle: float) -> float:
    """Wrap an angle in degrees to [-180, 180)."""
    return (angle + 180.0) % 360.0 - 180.0


def _phase_difference(result: NecResult) -> float:
    """Loop A minus loop B current phase, degrees, wrapped to [-180, 180)."""
    ia, ib = _loop_currents(result)
    pa = math.degrees(math.atan2(ia.imag, ia.real))
    pb = math.degrees(math.atan2(ib.imag, ib.real))
    return wrap_phase_deg(pa - pb)


def _loop_balance(result: NecResult) -> float:
    """Loop current magnitude ratio |I_B| / |I_A| (1.0 is balanced)."""
    ia, ib = _loop_currents(result)
    return abs(ib) / abs(ia) if abs(ia) > 0.0 else math.inf


def _antenna_feed_z(result: NecResult) -> complex:
    """Feedpoint impedance at the harness source (junction or port wire),
    before the match network or balun."""
    return complex(result.sources[0].z_real, result.sources[0].z_imag)


def _source_z(result: NecResult, tag: int) -> complex:
    """Driving-point impedance at the source on wire `tag`."""
    for source in result.sources:
        if source.tag == tag:
            return complex(source.z_real, source.z_imag)
    raise ValueError(f"nec2c reported no source on tag {tag}")


def _loop_feed_impedances(
    spec: DesignSpec, factor: float, phase_diff_deg: float
) -> tuple[complex, complex]:
    """Active driving-point impedance at each loop's feed gap.

    Replaces the harness with a voltage source on each loop feed, driven in the
    delivered quadrature (loop A at 1/_0, loop B at 1/_ minus the delivered
    current phase difference), and reads each source impedance. This is the
    impedance each loop presents at its feed while the antenna operates, with
    mutual coupling between the loops included.
    """
    egg, wavelength = _eggbeater(spec, factor)
    wires = egg.wires + _reflector_wires(spec, wavelength)
    phi = math.radians(phase_diff_deg)
    sources = (
        Source(egg.loop_a.feed_tag, egg.loop_a.feed_segment, 1.0, 0.0),
        Source(
            egg.loop_b.feed_tag,
            egg.loop_b.feed_segment,
            math.cos(phi),
            -math.sin(phi),
        ),
    )
    deck = build_deck(
        _comment_lines(spec),
        wires,
        sources,
        ground=spec.reflector == REFLECTOR_GROUND,
        freq_mhz=spec.freq_mhz,
        grid=DEFAULT_GRID,
    )
    result = run_nec(deck, spec.nec2c)
    return (
        _source_z(result, egg.loop_a.feed_tag),
        _source_z(result, egg.loop_b.feed_tag),
    )


def series_element_fitted(z: complex) -> bool:
    """Whether the match includes a series element for this feedpoint z."""
    return abs(z.imag) > MATCH_REACTANCE_WARN_OHMS


def series_match_element(z: complex, freq_mhz: float) -> tuple[str, float]:
    """Series element that cancels the feedpoint reactance.

    Returns the element kind ('inductor' or 'capacitor') and its value, in
    henries or farads.  Resizing the loops to null the reactance would move the
    axial-ratio optimum, so the reactance is instead tuned out at the feed.
    """
    omega = 2.0 * math.pi * freq_mhz * HZ_PER_MHZ
    if z.imag > 0.0:
        # Inductive feed: a series capacitor of equal reactance cancels it.
        return "capacitor", 1.0 / (omega * z.imag)
    # Capacitive feed: a series inductor cancels it.
    return "inductor", -z.imag / omega


def _axial_ratio_db(axial_ratio: float) -> float:
    """Convert NEC minor/major axial ratio to dB (0 dB = perfect circular)."""
    if axial_ratio <= 0.0:
        return math.inf
    return -20.0 * math.log10(axial_ratio)


def _cone_points(result: NecResult, theta_max_deg: float) -> list:
    """Usable pattern points within theta_max_deg of zenith.

    The RP grid emits the theta = 0 direction once per azimuth column; all are
    the same direction, so only the first is kept (otherwise zenith dominates
    any average over the cone).
    """
    cone = []
    seen_zenith = False
    for p in result.pattern:
        if p.theta_deg > theta_max_deg or p.total_gain_db <= NULL_GAIN_DB:
            continue
        if p.theta_deg == 0.0:
            if seen_zenith:
                continue
            seen_zenith = True
        cone.append(p)
    return cone


def _boresight_ar_db(result: NecResult) -> float:
    """Mean axial ratio (dB) over the high-elevation coverage cone.

    Axial ratio captures both the 90 deg phase split and the current-magnitude
    balance, so it is the proper single objective for circular polarization.
    """
    cone = _cone_points(result, BORESIGHT_THETA_DEG)
    if not cone:
        return math.inf
    return sum(_axial_ratio_db(p.axial_ratio) for p in cone) / len(cone)


def _cone_worst_ar_db(result: NecResult) -> float:
    """Worst axial ratio (dB) over the high-elevation coverage cone."""
    cone = _cone_points(result, BORESIGHT_THETA_DEG)
    if not cone:
        return math.inf
    return max(_axial_ratio_db(p.axial_ratio) for p in cone)


def _coverage_gain_db(result: NecResult) -> float:
    """Worst-case total gain (dBi) over the coverage cone.

    The minimum over theta <= COVERAGE_THETA_DEG is the lowest gain a pass sees
    in the high-elevation sky, so it bounds worst-case link margin there.
    """
    cone = _cone_points(result, COVERAGE_THETA_DEG)
    if not cone:
        return -math.inf
    return min(p.total_gain_db for p in cone)


def _boresight_sense(result: NecResult) -> str:
    """Polarization sense at the most circular point in the coverage cone."""
    cone = _cone_points(result, BORESIGHT_THETA_DEG)
    if not cone:
        return "UNKNOWN"
    best = min(cone, key=lambda p: _axial_ratio_db(p.axial_ratio))
    return best.sense


def _polarization_summary(result: NecResult) -> tuple[float, float, float, str]:
    """Cone mean and worst axial ratio (dB), peak axial ratio (dB), and
    boresight sense."""
    usable = [p for p in result.pattern if p.total_gain_db > NULL_GAIN_DB]
    if not usable:
        return math.inf, math.inf, math.inf, "UNKNOWN"
    peak = max(usable, key=lambda p: p.total_gain_db)
    return (
        _boresight_ar_db(result),
        _cone_worst_ar_db(result),
        _axial_ratio_db(peak.axial_ratio),
        _boresight_sense(result),
    )


def vswr(z: complex, reference: float = REFERENCE_IMPEDANCE_OHMS) -> float:
    """Voltage standing wave ratio of impedance z against a reference."""
    if z == -reference:
        return math.inf
    gamma = abs((z - reference) / (z + reference))
    if gamma >= 1.0:
        return math.inf
    return (1.0 + gamma) / (1.0 - gamma)


def quarter_wave_match_z0(
    z: complex, reference: float = REFERENCE_IMPEDANCE_OHMS
) -> float:
    """Characteristic impedance of a quarter-wave transformer.

    Matches the resistive part of z to the reference; any residual reactance
    must be tuned out separately.
    """
    return math.sqrt(reference * z.real)


def transformer_coax(
    z: complex,
    reference: float = REFERENCE_IMPEDANCE_OHMS,
    override: Coax | None = None,
) -> Coax:
    """Cable used for the quarter-wave transformer.

    The override (spec.match_coax) wins when set; otherwise the catalog cable
    nearest the ideal transformer impedance is suggested.
    """
    return override or nearest_standard_coax(quarter_wave_match_z0(z, reference))


def post_match_vswr(
    z: complex,
    reference: float = REFERENCE_IMPEDANCE_OHMS,
    coax: Coax | None = None,
) -> float:
    """SWR at the design frequency after the coax match network.

    A series element is fitted (and cancels the reactance) only when the
    reactance exceeds MATCH_REACTANCE_WARN_OHMS, matching the cut sheet;
    otherwise the residual reactance transforms through the quarter-wave
    coax along with the resistance.

    A non-positive feed resistance (NEC pathology at extreme geometries, e.g.
    loops very close to ground) is unmatchable: inf.
    """
    if z.real <= 0.0:
        return math.inf
    z0 = transformer_coax(z, reference, coax).z0_ohm
    load = complex(z.real, 0.0) if series_element_fitted(z) else z
    return vswr(z0 * z0 / load, reference)


def _balun4_radio_z(
    z_junction: complex, freq_mhz: float, design_freq_mhz: float
) -> complex:
    """Radio-side impedance of the balun4 harness, with line dispersion.

    The junction transforms through the quarter-wave balanced Q-section; the
    balanced load then splits into half per balun terminal, and the radio at
    terminal T1 sees that half in parallel with the other half through the
    physical half-wave line. At the design frequency this reduces exactly to
    the ideal 4:1 step (z_bal / 4); off design both lines drift.
    """
    theta_q = _quarter_wave_theta(freq_mhz, design_freq_mhz)
    z_bal = _line_input_z(z_junction, BALUN4_Q_COAX.z0_ohm, theta_q)
    half = z_bal / 2.0
    z_via_line = _line_input_z(half, BALUN4_BALUN_COAX.z0_ohm, 2.0 * theta_q)
    return half * z_via_line / (half + z_via_line)


def match_is_useful(spec: DesignSpec, z: complex) -> bool:
    """Whether the quarter-wave match beats connecting the feedline directly.

    A turnstile's junction already lands near the system impedance by
    construction, so the computed transformer usually snaps to a catalog cable
    equal to it -- an identity transform. Specifying it anyway would hand the
    builder an inert section of coax to cut, which is not what the published
    designs do. An explicitly requested match_coax is always honored.
    """
    if spec.feed in BALANCED_FEEDS:
        return False  # their harness or choke is the match
    if spec.match_coax is not None:
        return True
    direct = vswr(z, spec.system_z_ohm)
    matched = post_match_vswr(z, spec.system_z_ohm, spec.match_coax)
    return matched < direct - MATCH_VSWR_MARGIN


def matched_vswr(spec: DesignSpec, z: complex) -> float:
    """VSWR at the radio for the spec's feed scheme, as actually built.

    The balun4 feed reaches the radio through the quarter-wave balanced
    Q-section and the half-wave 4:1 balun; the choke feed uses a 1:1 ferrite
    choke balun (no impedance transform), so the radio sees the feedpoint
    impedance directly; the line feed uses the series-element/transformer match,
    but only when that improves on a direct connection (see match_is_useful).
    """
    if spec.feed == FEED_BALUN4:
        if z.real <= 0.0:
            return math.inf
        z_radio = _balun4_radio_z(z, spec.freq_mhz, spec.freq_mhz)
        return vswr(z_radio, spec.system_z_ohm)
    if spec.feed == FEED_CHOKE:
        return vswr(z, spec.system_z_ohm)
    if not match_is_useful(spec, z):
        return vswr(z, spec.system_z_ohm)
    return post_match_vswr(z, spec.system_z_ohm, spec.match_coax)


def _natural_hand(spec: DesignSpec) -> str | None:
    """Handedness of the normal (uncrossed) connection, from one coarse run.

    Handedness is structural -- it depends on the feed scheme and geometry
    conventions, not on fine tuning -- so an untuned probe suffices.
    """
    probe, _ = analyze(spec, SENSE_PROBE_FACTOR)
    return NEC_SENSE_TO_HAND.get(_boresight_sense(probe))


def design(spec: DesignSpec, with_loop_z: bool = True) -> DesignResult:
    """Tune an eggbeater to the spec and return the result.

    A coarse probe run reads the natural handedness; the requested sense then
    decides the normal or crossed loop B connection, and the whole design --
    tuning, feedpoint, and pattern -- is modeled with that delivered
    connection. Crossing is a mirror image only on boresight: the vertical
    loop offset makes the two senses slightly different antennas off-axis,
    so the delivered connection must be the one characterized.

    with_loop_z adds one extra nec2c run to characterize the per-loop feed-point
    impedances; the optimizer passes False since it needs only the match cost.
    """
    natural = _natural_hand(spec)
    crossed = natural is not None and natural != spec.sense
    base_factor = _quadrature_factor(spec, flip=crossed)
    result, deck = analyze(spec, base_factor, flip=crossed)
    ar_boresight, ar_worst, ar_peak, sense = _polarization_summary(result)
    phase_diff = _phase_difference(result)

    loop_a_z, loop_b_z = (None, None)
    if with_loop_z:
        loop_a_z, loop_b_z = _loop_feed_impedances(spec, base_factor, phase_diff)

    return DesignResult(
        spec=spec,
        base_factor=base_factor,
        z_in=_antenna_feed_z(result),
        phase_diff_deg=phase_diff,
        loop_balance=_loop_balance(result),
        crossed_phasing_line=crossed,
        sense=sense,
        ar_boresight_db=ar_boresight,
        ar_cone_worst_db=ar_worst,
        ar_peak_db=ar_peak,
        coverage_gain_db=_coverage_gain_db(result),
        deck=deck,
        loop_a_feed_z=loop_a_z,
        loop_b_feed_z=loop_b_z,
    )


def _reflector_cost(result: DesignResult) -> float:
    """Optimization cost: post-match SWR, penalized for excess axial ratio.

    The axial-ratio term is the worst over the coverage cone, so the optimizer
    drives the cone edge (not just the cone mean) under the budget.
    """
    spec = result.spec
    budget = AR_TARGET_DB - spec.ar_margin_db
    excess = max(0.0, result.ar_cone_worst_db - budget)
    return matched_vswr(spec, result.z_in) + AR_PENALTY_PER_DB * excess


def _knee_count(counts: tuple[int, ...], worst_ar_db: dict[int, float]) -> int:
    """Fewest radials at the diminishing-returns knee of worst-case cone AR.

    Walk the counts ascending, advancing to a larger count only while it lowers
    the worst cone axial ratio by at least AR_KNEE_DB; stop where the curve
    flattens. This keeps axial-ratio headroom (a marginal smaller count sitting
    right at the budget loses to the next count that buys real margin) without
    adding radials that barely help (or that cannot reach the budget at all).
    """
    ordered = sorted(counts)
    chosen = ordered[0]
    for prev, cur in zip(ordered, ordered[1:], strict=False):
        if worst_ar_db[prev] - worst_ar_db[cur] >= AR_KNEE_DB:
            chosen = cur
        else:
            break
    return chosen


def _best_placement(
    spec: DesignSpec, count: int, optimize_droop: bool
) -> tuple[float, DesignSpec, DesignResult] | None:
    """Coordinate-descent (spacing, droop) placement for a fixed radial count.

    Golden-section minimizes the match cost along each axis in turn, alternating
    for PLACEMENT_SWEEPS passes. The cost surface is smooth and unimodal, so a
    few sweeps reach a finer optimum than a fixed grid and never snap to a grid
    edge. Droop is held at zero for a ground reflector (no radials to tilt).

    Returns None when the converged placement cannot be realized (see
    DesignInfeasible), so the caller can pass over this radial count.
    """

    def cost_of(spacing: float, droop: float) -> float:
        candidate = replace(
            spec,
            radial_count=count,
            reflector_spacing_wl=spacing,
            radial_droop_deg=droop,
            optimization=None,
        )
        try:
            return _reflector_cost(design(candidate, with_loop_z=False))
        except DesignInfeasible:
            # Unbuildable geometry or untunable perimeter: score it out of the
            # search rather than aborting the whole run.
            return math.inf

    spacing = sum(SPACING_BOUNDS_WL) / 2.0
    droop = sum(DROOP_BOUNDS_DEG) / 2.0 if optimize_droop else 0.0
    for _ in range(PLACEMENT_SWEEPS):
        spacing = _golden_section_min(
            lambda s, d=droop: cost_of(s, d), *SPACING_BOUNDS_WL, SPACING_TOLERANCE_WL
        )
        if optimize_droop:
            droop = _golden_section_min(
                lambda d, s=spacing: cost_of(s, d),
                *DROOP_BOUNDS_DEG,
                DROOP_TOLERANCE_DEG,
            )

    candidate = replace(
        spec,
        radial_count=count,
        reflector_spacing_wl=spacing,
        radial_droop_deg=droop,
        optimization=None,
    )
    try:
        result = design(candidate, with_loop_z=False)
    except DesignInfeasible:
        return None
    return _reflector_cost(result), candidate, result


def optimize_reflector(spec: DesignSpec) -> DesignSpec:
    """Search radial count, spacing, and droop; return the best spec.

    A spec -> spec transform: the returned spec differs from the input only in
    the reflector geometry that best serves the design. For each radial count a
    coordinate descent finds the lowest-cost spacing/droop placement, then the
    count is chosen at the knee of the worst-case cone axial ratio versus count
    (the fewest radials past which more buy less than AR_KNEE_DB, see
    _knee_count). Droop and count apply only to radials; a ground reflector
    searches spacing alone.

    Axial ratio throughout is the worst over the coverage cone (its edge), not
    the cone mean.
    """
    radials = spec.reflector == REFLECTOR_RADIALS
    counts = tuple(sorted(RADIAL_COUNT_GRID if radials else (spec.radial_count,)))
    start = time.perf_counter()

    placements: dict[int, DesignSpec] = {}
    worst_ar_db: dict[int, float] = {}
    for count in counts:
        best = _best_placement(spec, count, optimize_droop=radials)
        if best is None:
            continue  # no realizable placement at this radial count
        _, candidate, result = best
        placements[count] = candidate
        worst_ar_db[count] = result.ar_cone_worst_db
    if not placements:
        raise DesignInfeasible(
            "no realizable reflector placement was found for this spec at any "
            f"radial count in {counts}"
        )
    best_spec = placements[_knee_count(tuple(sorted(placements)), worst_ar_db)]

    provenance = Optimization(
        input=replace(spec, optimization=None),
        method="coordinate descent (golden-section per axis)",
        spacing_bounds_wl=SPACING_BOUNDS_WL,
        droop_bounds_deg=DROOP_BOUNDS_DEG if radials else (0.0, 0.0),
        spacing_tolerance_wl=SPACING_TOLERANCE_WL,
        droop_tolerance_deg=DROOP_TOLERANCE_DEG if radials else 0.0,
        sweeps=PLACEMENT_SWEEPS,
        radial_count_grid=counts,
        ar_target_db=AR_TARGET_DB,
        ar_margin_db=spec.ar_margin_db,
        ar_penalty_per_db=AR_PENALTY_PER_DB,
        feasible_vswr=FEASIBLE_VSWR,
        objective=(
            "radial count at the worst-case cone AR knee, "
            "spacing/droop minimizing match cost"
        ),
        elapsed_s=round(time.perf_counter() - start, 3),
    )
    return replace(best_spec, optimization=provenance)


def _line_input_z(z_load: complex, z0: float, theta: float) -> complex:
    """Input impedance of a lossless line of electrical length theta (rad)."""
    tan_theta = math.tan(theta)
    return z0 * (z_load + 1j * z0 * tan_theta) / (z0 + 1j * z_load * tan_theta)


def _quarter_wave_theta(freq_mhz: float, design_freq_mhz: float) -> float:
    """Electrical length of a fixed quarter-wave-at-design line at freq_mhz."""
    return (math.pi / 2.0) * (freq_mhz / design_freq_mhz)


def _matched_input_z(
    z_ant: complex,
    freq_mhz: float,
    design_freq_mhz: float,
    z_center: complex,
    system_z: float,
    match_coax: Coax | None,
) -> complex:
    """Input impedance after the match network sized at the design frequency.

    The series element (fitted and sized from z_center only when the cut sheet
    includes one) and the quarter-wave transformer are fixed by the design;
    here they are evaluated at freq_mhz.
    """
    z_after_series = z_ant
    if series_element_fitted(z_center):
        omega = 2.0 * math.pi * freq_mhz * HZ_PER_MHZ
        kind, value = series_match_element(z_center, design_freq_mhz)
        reactance = omega * value if kind == "inductor" else -1.0 / (omega * value)
        z_after_series = z_ant + 1j * reactance

    z0 = transformer_coax(z_center, system_z, match_coax).z0_ohm
    theta = _quarter_wave_theta(freq_mhz, design_freq_mhz)
    return _line_input_z(z_after_series, z0, theta)


@dataclass(frozen=True)
class SweepPoint:
    """One frequency-sweep sample.

    Fields:
        freq_mhz: analysis frequency.
        vswr: SWR at the system impedance after the fixed match network.
        ar_db: boresight axial ratio (dB; 0 is perfect circular).
    """

    freq_mhz: float
    vswr: float
    ar_db: float


def frequency_sweep(
    result: DesignResult,
    span_fraction: float = SWEEP_SPAN_FRACTION,
    points: int = SWEEP_POINTS,
) -> list[SweepPoint]:
    """Matched SWR and boresight axial ratio versus frequency.

    The tuned physical geometry is held fixed and swept across +/- span_fraction;
    the match network is fixed at the design frequency.  The phasing line is a
    fixed length, so it drifts from 90 deg off design (real dispersion).
    """
    spec = result.spec
    design_freq = spec.freq_mhz
    base = result.base_factor
    low = design_freq * (1.0 - span_fraction)
    high = design_freq * (1.0 + span_fraction)
    sweep = []
    for i in range(points):
        freq = low + (high - low) * i / (points - 1)
        nec, _ = analyze(spec, base, run_freq_mhz=freq)
        z_ant = _antenna_feed_z(nec)
        if spec.feed == FEED_BALUN4:
            z_in = _balun4_radio_z(z_ant, freq, design_freq)
        elif spec.feed == FEED_CHOKE:
            # A 1:1 ferrite choke passes the feed Z straight to the radio.
            z_in = z_ant
        else:
            z_in = _matched_input_z(
                z_ant,
                freq,
                design_freq,
                result.z_in,
                spec.system_z_ohm,
                spec.match_coax,
            )
        sweep.append(
            SweepPoint(freq, vswr(z_in, spec.system_z_ohm), _boresight_ar_db(nec))
        )
    return sweep


def bandwidth_within(
    pairs: list[tuple[float, float]], limit: float
) -> tuple[float, float] | None:
    """Contiguous frequency band around the center where value <= limit.

    Each pair is (freq_mhz, value). Edges are linearly interpolated between
    samples. Returns (low, high) MHz, or None if the center already exceeds the
    limit.
    """
    center = len(pairs) // 2
    if pairs[center][1] > limit:
        return None

    def edge(indices) -> float:
        previous = center
        for i in indices:
            freq, value = pairs[i]
            if value > limit:
                f0, v0 = pairs[previous]
                # Interpolate the crossing between previous and this sample.
                frac = (limit - v0) / (value - v0)
                return f0 + (freq - f0) * frac
            previous = i
        return pairs[indices[-1]][0]

    low_edge = edge(range(center - 1, -1, -1))
    high_edge = edge(range(center + 1, len(pairs)))
    return low_edge, high_edge
