"""Design orchestration: build geometry, drive nec2c, tune resonance and phase.

Two equal resonant loops share one feed at the junction: the feed drives loop A
directly while loop B is fed through a quarter-wave phasing line (a NEC TL card),
putting the two loop currents 90 deg apart for circular polarization. A crossed
line (negative Z0) reverses the handedness.
"""

import math
import time
from dataclasses import dataclass, replace

from .coax import RG_62, Coax, nearest_standard_coax
from .conductor import Conductor
from .geometry import (
    DEFAULT_SEGMENTS,
    LOOP_A_TAG_BASE,
    LOOP_B_TAG_BASE,
    SHAPE_CIRCLE,
    Wire,
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

# Map nec2c's polarization sense column to a handedness constant, and back.
NEC_SENSE_TO_HAND = {"RIGHT": SENSE_RHCP, "LEFT": SENSE_LHCP}
HAND_TO_NEC_SENSE = {SENSE_RHCP: "RIGHT", SENSE_LHCP: "LEFT"}

# Target NEC segment length along a radial, in wavelengths.
RADIAL_SEGMENT_WL = 0.05

# Quarter-wave phasing line: a NEC ideal TL of this electrical length (free-space
# wavelengths) gives the 90 deg between the loop currents.
PHASING_LINE_WL = 0.25
REFERENCE_IMPEDANCE_OHMS = 50.0
# Residual feedpoint reactance above which a series tuning element is sized.
MATCH_REACTANCE_WARN_OHMS = 10.0
HZ_PER_MHZ = 1.0e6

# Upper-hemisphere sampling grid: theta 0..80 deg, phi 0..90 deg.
DEFAULT_GRID = RadiationGrid(
    ntheta=9, nphi=7, theta0=0.0, phi0=0.0, dtheta=10.0, dphi=15.0
)

# Bounds and convergence controls for the solvers.
FACTOR_BOUNDS = (0.70, 1.40)
SOLVER_MAX_ITERATIONS = 40
REACTANCE_TOLERANCE_OHMS = 0.5
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
SPACING_BOUNDS_WL = (0.15, 0.40)
DROOP_BOUNDS_DEG = (0.0, 50.0)
# Coordinate-descent tolerances (the placement is refined to this resolution).
SPACING_TOLERANCE_WL = 0.005
DROOP_TOLERANCE_DEG = 1.0
# Alternating spacing/droop passes per radial count.
PLACEMENT_SWEEPS = 2
# Radial counts searched, ascending; the optimizer keeps the fewest that meets
# the objectives (fewer radials is cheaper, lighter, and less wind load).
RADIAL_COUNT_GRID = (3, 4, 6, 8)
AR_TARGET_DB = 3.0
# Default spec.ar_margin_db: margin the optimizer holds below AR_TARGET_DB at
# band center, so the design does not sit exactly at the budget with no usable
# axial-ratio bandwidth.
AR_MARGIN_DB = 0.5
# Cost penalty per dB of axial ratio above the margin-tightened budget.
AR_PENALTY_PER_DB = 1.0
# A radial count is acceptable when the tuned design holds axial ratio within
# the margin-tightened budget and post-match VSWR within this limit.
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
        reflector_spacing_wl: loop-centre height above the reflector, wavelengths.
        phasing_coax: cable of the quarter-wave phasing line feeding loop B.
            Its z0_ohm drives the NEC TL model; its vf sets only the reported
            physical cut length (the NEC line is an ideal electrical quarter
            wave).
        match_coax: cable of the quarter-wave matching transformer, or None to
            suggest the catalog cable nearest the computed transformer Z0.
        sense: desired polarization, SENSE_RHCP or SENSE_LHCP.
        loop_shape: loop outline, SHAPE_CIRCLE, SHAPE_SQUARE, or SHAPE_SQUIRCLE.
        corner_radius_wl: rounded-corner radius for the squircle shape, in
            wavelengths (ignored for circle and square).
        loop_offset_mm: vertical gap between the two loop centres (loop A below,
            loop B above) so the crossed conductors clear at the top and bottom.
        feed_gap_mm: width of the feed gap at the bottom of each loop, where the
            line connects.
        system_z_ohm: radio-end reference impedance the match targets (50 or 75).
        ar_margin_db: margin the reflector optimizer holds below the
            AR_TARGET_DB budget at band center, keeping usable axial-ratio
            bandwidth around the design frequency.
        segments: polygon sides per loop.
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
    phasing_coax: Coax = RG_62
    match_coax: Coax | None = None
    sense: str = SENSE_RHCP
    loop_shape: str = SHAPE_CIRCLE
    corner_radius_wl: float = 0.05
    loop_offset_mm: float = 5.0
    feed_gap_mm: float = 10.0
    system_z_ohm: float = 50.0
    ar_margin_db: float = AR_MARGIN_DB
    segments: int = DEFAULT_SEGMENTS
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
        ar_target_db: axial-ratio budget the search held to.
        ar_margin_db: margin held below the budget at band center.
        ar_penalty_per_db: cost penalty per dB of axial ratio above the
            margin-tightened budget.
        feasible_vswr: post-match VSWR a radial count had to meet to be kept.
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
        base_factor: resonant perimeter as a multiple of wavelength.
        z_in: predicted feedpoint impedance at the junction (feedline side,
            before the match network).
        phase_diff_deg: loop current phase difference (loop A minus loop B).
        loop_balance: loop current magnitude ratio |I_B| / |I_A| (1.0 is
            balanced; boresight axial ratio is 20*log10(max(r, 1/r)) dB).
        crossed_phasing_line: whether the phasing line is connected crossed to
            deliver the requested sense (the cut-sheet wiring instruction).
        sense: achieved polarization sense (nec2c vocabulary, e.g. RIGHT).
        ar_boresight_db: mean axial ratio over the high-elevation coverage cone
            (theta <= BORESIGHT_THETA_DEG), dB; 0 is perfect circular.
        ar_peak_db: axial ratio at the pattern peak (dB).
        coverage_gain_db: worst-case total gain over the coverage cone
            (theta <= COVERAGE_THETA_DEG), dBi.
        deck: the tuned NEC deck text (with the chosen line connection).
    """

    spec: DesignSpec
    base_factor: float
    z_in: complex
    phase_diff_deg: float
    loop_balance: float
    crossed_phasing_line: bool
    sense: str
    ar_boresight_db: float
    ar_peak_db: float
    coverage_gain_db: float
    deck: str


def _center_z_m(spec: DesignSpec, wavelength: float, perimeter_m: float) -> float:
    if spec.reflector in (REFLECTOR_GROUND, REFLECTOR_RADIALS):
        # Loop centre sits the given spacing above the reflector plane (z = 0).
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
    z0 = -spec.phasing_coax.z0_ohm if flip else spec.phasing_coax.z0_ohm
    line = TransmissionLine(
        egg.loop_a.feed_tag,
        egg.loop_a.feed_segment,
        egg.loop_b.feed_tag,
        egg.loop_b.feed_segment,
        z0,
        PHASING_LINE_WL * wavelength,
    )
    return (source,), (line,)


def _eggbeater(spec: DesignSpec, factor: float):
    """Build the crossed-loop geometry for a perimeter factor; returns
    (eggbeater, wavelength)."""
    wavelength = wavelength_m(spec.freq_mhz)
    perimeter = factor * wavelength
    center_z = _center_z_m(spec, wavelength, perimeter)
    egg = make_eggbeater(
        perimeter,
        perimeter,
        center_z,
        spec.conductor.equivalent_radius_m,
        spec.segments,
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
    sources, lines = _feed(egg, spec, wavelength, flip)
    wires = egg.wires + _reflector_wires(spec, wavelength)
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
    points (midpoint of each loop's bottom feed wire), in metres.
    """
    egg, wavelength = _eggbeater(result.spec, result.base_factor)
    wires = egg.wires + _reflector_wires(result.spec, wavelength)
    feeds = tuple(
        ((w.x1 + w.x2) / 2.0, (w.y1 + w.y2) / 2.0, (w.z1 + w.z2) / 2.0)
        for w in (_feed_wire(egg.loop_a), _feed_wire(egg.loop_b))
    )
    return wires, feeds


def _secant(func, x0: float, x1: float, bounds, tolerance: float) -> float:
    """Bounded secant root find for a scalar function."""
    low, high = bounds
    f0 = func(x0)
    f1 = func(x1)
    for _ in range(SOLVER_MAX_ITERATIONS):
        if abs(f1) <= tolerance:
            return x1
        denom = f1 - f0
        if denom == 0.0:
            return x1
        x2 = x1 - f1 * (x1 - x0) / denom
        x2 = min(max(x2, low), high)
        x0, f0 = x1, f1
        x1, f1 = x2, func(x2)
    return x1


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


def _resonant_factor(spec: DesignSpec) -> float:
    """Find the perimeter factor giving zero reactance at the junction feed."""

    def reactance(factor: float) -> float:
        result, _ = analyze(spec, factor)
        return result.sources[0].z_imag

    return _secant(reactance, 1.0, 1.05, FACTOR_BOUNDS, REACTANCE_TOLERANCE_OHMS)


def _loop_currents(result: NecResult) -> tuple[complex, complex]:
    """Feed-segment currents of loop A and loop B."""
    return result.feed_current(LOOP_A_TAG_BASE), result.feed_current(LOOP_B_TAG_BASE)


def _phase_difference(result: NecResult) -> float:
    """Loop A minus loop B current phase, degrees."""
    ia, ib = _loop_currents(result)
    pa = math.degrees(math.atan2(ia.imag, ia.real))
    pb = math.degrees(math.atan2(ib.imag, ib.real))
    return pa - pb


def _loop_balance(result: NecResult) -> float:
    """Loop current magnitude ratio |I_B| / |I_A| (1.0 is balanced)."""
    ia, ib = _loop_currents(result)
    return abs(ib) / abs(ia) if abs(ia) > 0.0 else math.inf


def _antenna_feed_z(result: NecResult) -> complex:
    """Feedpoint impedance at the junction (loop A's source), before the match."""
    return complex(result.sources[0].z_real, result.sources[0].z_imag)


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


def _boresight_ar_db(result: NecResult) -> float:
    """Mean axial ratio (dB) over the high-elevation coverage cone.

    Axial ratio captures both the 90 deg phase split and the current-magnitude
    balance, so it is the proper single objective for circular polarization.
    """
    cone = [
        p
        for p in result.pattern
        if p.theta_deg <= BORESIGHT_THETA_DEG and p.total_gain_db > NULL_GAIN_DB
    ]
    if not cone:
        return math.inf
    return sum(_axial_ratio_db(p.axial_ratio) for p in cone) / len(cone)


def _coverage_gain_db(result: NecResult) -> float:
    """Worst-case total gain (dBi) over the coverage cone.

    The minimum over theta <= COVERAGE_THETA_DEG is the lowest gain a pass sees
    in the high-elevation sky, so it bounds worst-case link margin there.
    """
    cone = [
        p.total_gain_db
        for p in result.pattern
        if p.theta_deg <= COVERAGE_THETA_DEG and p.total_gain_db > NULL_GAIN_DB
    ]
    if not cone:
        return -math.inf
    return min(cone)


def _boresight_sense(result: NecResult) -> str:
    """Polarization sense at the most circular point in the coverage cone."""
    cone = [
        p
        for p in result.pattern
        if p.theta_deg <= BORESIGHT_THETA_DEG and p.total_gain_db > NULL_GAIN_DB
    ]
    if not cone:
        return "UNKNOWN"
    best = min(cone, key=lambda p: _axial_ratio_db(p.axial_ratio))
    return best.sense


def _polarization_summary(result: NecResult) -> tuple[float, float, str]:
    """Boresight axial ratio (dB), peak axial ratio (dB), and boresight sense."""
    usable = [p for p in result.pattern if p.total_gain_db > NULL_GAIN_DB]
    if not usable:
        return math.inf, math.inf, "UNKNOWN"
    peak = max(usable, key=lambda p: p.total_gain_db)
    return (
        _boresight_ar_db(result),
        _axial_ratio_db(peak.axial_ratio),
        _boresight_sense(result),
    )


def vswr(z: complex, reference: float = REFERENCE_IMPEDANCE_OHMS) -> float:
    """Voltage standing wave ratio of impedance z against a reference."""
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

    The series element cancels the reactance and the transformer coax scales
    the resistance toward the reference.
    """
    z0 = transformer_coax(z, reference, coax).z0_ohm
    transformed = z0 * z0 / z.real
    return vswr(complex(transformed, 0.0), reference)


def design(spec: DesignSpec) -> DesignResult:
    """Tune an eggbeater to the spec and return the result.

    One nec2c run sizes the loops and characterizes the (mirror-symmetric)
    pattern; the requested polarization sense is then just which way the phasing
    line is connected (normal or crossed), with identical performance, so no
    second run is needed -- crossing only changes the cut-sheet wiring.
    """
    base_factor = _resonant_factor(spec)
    result, deck = analyze(spec, base_factor)
    ar_boresight, ar_peak, default_sense = _polarization_summary(result)

    default_hand = NEC_SENSE_TO_HAND.get(default_sense)
    if default_hand is None:
        crossed, sense = False, default_sense
    else:
        crossed = default_hand != spec.sense
        sense = HAND_TO_NEC_SENSE[spec.sense]
    if crossed:
        # Mirror image: identical performance, only the line connection changes.
        deck = _build_deck_text(spec, base_factor, True, None, None)

    return DesignResult(
        spec=spec,
        base_factor=base_factor,
        z_in=_antenna_feed_z(result),
        phase_diff_deg=_phase_difference(result),
        loop_balance=_loop_balance(result),
        crossed_phasing_line=crossed,
        sense=sense,
        ar_boresight_db=ar_boresight,
        ar_peak_db=ar_peak,
        coverage_gain_db=_coverage_gain_db(result),
        deck=deck,
    )


def _reflector_cost(result: DesignResult) -> float:
    """Optimization cost: post-match SWR, penalized for excess axial ratio."""
    spec = result.spec
    budget = AR_TARGET_DB - spec.ar_margin_db
    excess = max(0.0, result.ar_boresight_db - budget)
    swr = post_match_vswr(result.z_in, spec.system_z_ohm, spec.match_coax)
    return swr + AR_PENALTY_PER_DB * excess


def _reflector_feasible(result: DesignResult) -> bool:
    """Whether a tuned design meets the axial-ratio and match objectives."""
    spec = result.spec
    return (
        result.ar_boresight_db <= AR_TARGET_DB - spec.ar_margin_db
        and post_match_vswr(result.z_in, spec.system_z_ohm, spec.match_coax)
        <= FEASIBLE_VSWR
    )


def _best_placement(
    spec: DesignSpec, count: int, optimize_droop: bool
) -> tuple[float, DesignSpec, DesignResult]:
    """Coordinate-descent (spacing, droop) placement for a fixed radial count.

    Golden-section minimizes the match cost along each axis in turn, alternating
    for PLACEMENT_SWEEPS passes. The cost surface is smooth and unimodal, so a
    few sweeps reach a finer optimum than a fixed grid and never snap to a grid
    edge. Droop is held at zero for a ground reflector (no radials to tilt).
    """

    def cost_of(spacing: float, droop: float) -> float:
        candidate = replace(
            spec,
            radial_count=count,
            reflector_spacing_wl=spacing,
            radial_droop_deg=droop,
            optimization=None,
        )
        return _reflector_cost(design(candidate))

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
    result = design(candidate)
    return _reflector_cost(result), candidate, result


def optimize_reflector(spec: DesignSpec) -> DesignSpec:
    """Search radial count, spacing, and droop; return the best spec.

    A spec -> spec transform: the returned spec differs from the input only in
    the reflector geometry that best serves the design. Radial count is searched
    ascending and the fewest that meets the objectives (axial ratio within
    AR_TARGET_DB, post-match VSWR within FEASIBLE_VSWR) is kept; for each count a
    coordinate descent finds the lowest-cost spacing/droop placement. If no count
    is feasible the lowest-cost candidate overall is returned. Droop and count
    apply only to radials; a ground reflector searches spacing alone.
    """
    radials = spec.reflector == REFLECTOR_RADIALS
    counts = tuple(sorted(RADIAL_COUNT_GRID if radials else (spec.radial_count,)))
    start = time.perf_counter()

    chosen: DesignSpec | None = None
    fallback: tuple[float, DesignSpec] | None = None
    for count in counts:
        cost, candidate, result = _best_placement(spec, count, optimize_droop=radials)
        if fallback is None or cost < fallback[0]:
            fallback = (cost, candidate)
        if _reflector_feasible(result):
            chosen = candidate
            break
    best_spec = chosen if chosen is not None else fallback[1]

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
        objective="fewest radials meeting AR and VSWR, then minimize match cost",
        elapsed_s=round(time.perf_counter() - start, 3),
    )
    return replace(best_spec, optimization=provenance)


def _matched_input_z(
    z_ant: complex,
    freq_mhz: float,
    design_freq_mhz: float,
    z_center: complex,
    system_z: float,
    match_coax: Coax | None,
) -> complex:
    """Input impedance after the match network sized at the design frequency.

    The series element (sized from z_center) and the quarter-wave transformer
    are fixed by the design; here they are evaluated at freq_mhz.
    """
    omega = 2.0 * math.pi * freq_mhz * HZ_PER_MHZ
    kind, value = series_match_element(z_center, design_freq_mhz)
    series_reactance = omega * value if kind == "inductor" else -1.0 / (omega * value)
    z_after_series = z_ant + 1j * series_reactance

    z0 = transformer_coax(z_center, system_z, match_coax).z0_ohm
    # The line is a quarter wave at the design frequency, so its electrical
    # length scales linearly with frequency.
    theta = (math.pi / 2.0) * (freq_mhz / design_freq_mhz)
    tan_theta = math.tan(theta)
    return (
        z0
        * (z_after_series + 1j * z0 * tan_theta)
        / (z0 + 1j * z_after_series * tan_theta)
    )


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
        z_in = _matched_input_z(
            z_ant, freq, design_freq, result.z_in, spec.system_z_ohm, spec.match_coax
        )
        sweep.append(
            SweepPoint(freq, vswr(z_in, spec.system_z_ohm), _boresight_ar_db(nec))
        )
    return sweep


def bandwidth_within(
    pairs: list[tuple[float, float]], limit: float
) -> tuple[float, float] | None:
    """Contiguous frequency band around the centre where value <= limit.

    Each pair is (freq_mhz, value). Edges are linearly interpolated between
    samples. Returns (low, high) MHz, or None if the centre already exceeds the
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
