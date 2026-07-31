import json
import math
import re
import shutil
from dataclasses import replace

import pytest

from awadateki.cli import main
from awadateki.conductor import round_conductor
from awadateki.design import (
    AR_TARGET_DB,
    REFLECTOR_RADIALS,
    VSWR_LIMIT,
    DesignInfeasible,
    DesignResult,
    DesignSpec,
    _eggbeater,
    _knee_count,
    _reflector_cost,
    _secant,
    bandwidth_within,
    design,
    frequency_sweep,
    optimize_reflector,
    post_match_vswr,
    wrap_phase_deg,
)

HAS_NEC2C = shutil.which("nec2c") is not None
needs_nec2c = pytest.mark.skipif(not HAS_NEC2C, reason="nec2c not installed")

PAIR_JSON = json.dumps(
    [
        {"freq_mhz": 145.9, "conductor": {"kind": "round", "diameter_mm": 5.0}},
        {"freq_mhz": 436.0, "conductor": {"kind": "round", "diameter_mm": 3.0}},
    ]
)


def test_deck_rejects_multi_design(tmp_path, capsys):
    path = tmp_path / "pair.json"
    path.write_text(PAIR_JSON)
    with pytest.raises(SystemExit):
        main([str(path), "--deck", str(tmp_path / "out.nec")])


@needs_nec2c
def test_plot_artifact_structure():
    from awadateki.plot import render_artifact

    result = design(replace(_spec(), reflector="ground", label="2 m"))
    page = render_artifact([result])
    # Four line charts, the gain and axial-ratio az-el maps, and the feed
    # schematic for one design.
    assert page.count("<svg") == 7
    assert page.count("<polyline") == 4  # one trace per line chart for one design
    # One interactive geometry canvas (id geom0) with its inline data script and
    # the orbit viewer inlined once.
    assert page.count('id="geom0"') == 1
    assert page.count('id="geom0-data"') == 1
    assert "querySelectorAll" in page
    assert "2 m" in page
    assert "<title>" in page


@needs_nec2c
def test_main_reads_stdin(monkeypatch, capsys):
    import io

    spec = '{"freq_mhz": 145.9, "conductor": {"kind": "round", "diameter_mm": 5.0}}'
    monkeypatch.setattr("sys.stdin", io.StringIO(spec))
    assert main(["-"]) == 0
    assert "Eggbeater cut sheet" in capsys.readouterr().out


def _spec() -> DesignSpec:
    # Coarse polygon keeps the nec2c-in-the-loop tests fast.
    return DesignSpec(
        freq_mhz=145.9,
        conductor=round_conductor(3.0),
        reflector="none",
        reflector_spacing_wl=0.25,
        sense="rhcp",
        segments=16,
    )


@needs_nec2c
def test_design_tunes_to_quadrature():
    result = design(_spec())
    assert 0.8 < result.base_factor < 1.2
    # The tuning objective: loop currents in quadrature.
    assert abs(abs(result.phase_diff_deg) - 90.0) < 1.0
    # Residual source reactance at quadrature stays small enough to match.
    assert abs(result.z_in.imag) < 15.0
    assert math.isfinite(result.ar_boresight_db)


@needs_nec2c
def test_coverage_gain_reported():
    from awadateki.report import format_cut_sheet

    result = design(replace(_spec(), reflector="ground"))
    assert math.isfinite(result.coverage_gain_db)
    assert "coverage gain" in format_cut_sheet(result)


@needs_nec2c
def test_square_loop_design_runs():
    # 16 segments divides by 4, so the square's corners land on vertices.
    result = design(replace(_spec(), loop_shape="square"))
    assert math.isfinite(result.ar_boresight_db)
    # One wire per polygon side, per loop; the feed gap is not modeled.
    assert result.deck.count("\nGW ") == 2 * result.spec.segments


@needs_nec2c
def test_radial_reflector_runs():
    spec = replace(_spec(), reflector="radials")
    result = design(spec)
    assert math.isfinite(result.ar_boresight_db)
    assert result.deck.count("\nGW ") == 2 * spec.segments + spec.radial_count


@needs_nec2c
def test_balun4_feed_designs():
    result = design(replace(_spec(), reflector="ground", feed="balun4", segments=36))
    # The junction: two ~100 ohm loops paralleled by the 100 ohm balanced
    # phasing line land near 50 ohm (F5VIF's stated figure).
    assert 40.0 < result.z_in.real < 60.0
    assert abs(result.z_in.imag) < 5.0
    # Balance is |Z_loop| / 100 ohm. With the mesh converged the loop settles
    # near 128 ohm, so the 100 ohm phasing line leaves it around 1.28 rather
    # than at unity -- see docs/reference-designs.md.
    assert 1.15 < result.loop_balance < 1.45
    assert math.isfinite(result.ar_boresight_db)
    # No port wires: the Q-section and balun are outside the NEC model.
    assert result.deck.count("\nGW ") == 2 * result.spec.segments


@needs_nec2c
def test_choke_feed_designs():
    # The choke shares balun4's differential NEC model, so it lands at the
    # same ~50 ohm junction; it differs only in the match hardware.
    result = design(replace(_spec(), reflector="ground", feed="choke", segments=36))
    assert 40.0 < result.z_in.real < 60.0
    assert abs(result.z_in.imag) < 5.0
    assert 1.15 < result.loop_balance < 1.45
    assert result.deck.count("\nGW ") == 2 * result.spec.segments


def test_unknown_feed_rejected():
    from awadateki.design import _build_deck_text

    with pytest.raises(ValueError, match="feed"):
        _build_deck_text(replace(_spec(), feed="bogus"), 1.0, False, None, None)


@needs_nec2c
def test_sense_selection_flips_handedness():
    rhcp = design(replace(_spec(), reflector="ground", sense="rhcp"))
    lhcp = design(replace(_spec(), reflector="ground", sense="lhcp"))
    assert rhcp.sense == "RIGHT"
    assert lhcp.sense == "LEFT"


@needs_nec2c
def test_crossed_design_reports_delivered_pattern():
    from awadateki.design import _coverage_gain_db, _polarization_summary, analyze

    # The loops' natural sense is RHCP, so LHCP forces the crossed connection;
    # the reported metrics must come from the crossed (delivered) run.
    spec = replace(_spec(), reflector="ground", feed="line", sense="lhcp")
    result = design(spec)
    assert result.crossed_phasing_line
    assert result.sense == "LEFT"
    nec, _ = analyze(spec, result.base_factor, flip=True)
    ar_mean, ar_worst, _, _ = _polarization_summary(nec)
    assert math.isclose(result.ar_boresight_db, ar_mean, abs_tol=1e-9)
    assert math.isclose(result.ar_cone_worst_db, ar_worst, abs_tol=1e-9)
    assert math.isclose(result.coverage_gain_db, _coverage_gain_db(nec), abs_tol=1e-9)


def test_match_omitted_when_it_does_not_help():
    from awadateki.coax import RG_59
    from awadateki.design import match_is_useful
    from awadateki.result import result_to_dict

    line = replace(_spec(), feed="line")
    # A turnstile junction already near 50 ohm: the transformer snaps to a
    # catalog cable equal to the system impedance and does nothing.
    assert not match_is_useful(line, complex(46.0, 0.0))
    # A junction far from 50 ohm: the transformer earns its place.
    assert match_is_useful(line, complex(25.0, 0.0))
    assert match_is_useful(line, complex(112.5, 0.0))
    # An explicitly requested cable is always honored.
    assert match_is_useful(replace(line, match_coax=RG_59), complex(46.0, 0.0))
    # The balanced feeds match through their own harness.
    assert not match_is_useful(replace(line, feed="choke"), complex(46.0, 0.0))

    # The reported match and VSWR agree with that decision.
    result = DesignResult(
        spec=line,
        base_factor=1.05,
        z_in=complex(46.0, 0.0),
        phase_diff_deg=90.0,
        loop_balance=1.0,
        crossed_phasing_line=False,
        sense="RIGHT",
        ar_boresight_db=1.0,
        ar_cone_worst_db=2.0,
        ar_peak_db=0.5,
        coverage_gain_db=1.0,
        deck="",
    )
    build = result_to_dict(result)["build"]
    assert build["match"] == {"system_z_ohm": 50.0, "network": "direct"}
    assert "transformer_coax" not in build["match"]
    from awadateki.design import matched_vswr, vswr

    assert matched_vswr(line, complex(46.0, 0.0)) == vswr(complex(46.0, 0.0), 50.0)


def test_post_match_vswr_ideal():
    # 112.5 ohm transforms through a 75 ohm quarter wave to exactly 50 ohm.
    assert math.isclose(post_match_vswr(complex(112.5, 0.0)), 1.0, abs_tol=1e-6)


def test_post_match_vswr_carries_unfitted_reactance():
    # Below the 10 ohm threshold no series element is fitted, so the residual
    # reactance transforms through the quarter wave and degrades the SWR.
    ideal = post_match_vswr(complex(112.5, 0.0))
    residual = post_match_vswr(complex(112.5, 8.0))
    assert residual > ideal + 0.05
    # Above the threshold the element cancels the reactance exactly.
    assert math.isclose(post_match_vswr(complex(112.5, -16.0)), ideal, abs_tol=1e-9)


def test_post_match_vswr_negative_resistance_is_inf():
    # NEC can report a negative feed resistance at pathological geometries
    # (e.g. loops ~0.15 wl over ground); the match must not crash on it.
    assert post_match_vswr(complex(-3.6, -0.1)) == math.inf


def test_balun4_radio_z_dispersion():
    from awadateki.design import BALUN4_Q_COAX, _balun4_radio_z

    z_junction = complex(49.6, 0.0)
    # At the design frequency the circuit reduces to the ideal 4:1 step.
    ideal = BALUN4_Q_COAX.z0_ohm**2 / z_junction / 4.0
    assert abs(_balun4_radio_z(z_junction, 145.9, 145.9) - ideal) < 1e-9
    # Off design the half-wave balun's own drift shifts the impedance beyond
    # what the Q-section alone would (the old frequency-flat model).
    from awadateki.design import _line_input_z, _quarter_wave_theta

    theta = _quarter_wave_theta(160.0, 145.9)
    flat = _line_input_z(z_junction, BALUN4_Q_COAX.z0_ohm, theta) / 4.0
    dispersive = _balun4_radio_z(z_junction, 160.0, 145.9)
    assert abs(dispersive - flat) > 1.0


def test_vswr_negative_reference_impedance_is_inf():
    from awadateki.design import vswr

    assert vswr(complex(-50.0, 0.0), 50.0) == math.inf


def test_wrap_phase_deg():
    assert wrap_phase_deg(340.0) == -20.0
    assert wrap_phase_deg(-190.0) == 170.0
    assert wrap_phase_deg(88.0) == 88.0
    assert wrap_phase_deg(180.0) == -180.0


def test_cone_ar_dedupes_zenith():
    from awadateki.design import _boresight_ar_db, _cone_worst_ar_db
    from awadateki.nec import NecResult, PatternPoint

    # Zenith (0 dB AR) appears once per azimuth column; the ring point is 6 dB.
    zenith = [PatternPoint(0.0, phi, 5.0, 1.0, "RIGHT") for phi in (0.0, 45.0, 90.0)]
    ring = [PatternPoint(10.0, 0.0, 5.0, 0.5, "RIGHT")]
    nec = NecResult(sources=(), pattern=tuple(zenith + ring))
    # Mean counts zenith once: (0 + 6.02) / 2, not (0 + 0 + 0 + 6.02) / 4.
    assert math.isclose(_boresight_ar_db(nec), 3.0103, abs_tol=1e-3)
    assert math.isclose(_cone_worst_ar_db(nec), 6.0206, abs_tol=1e-3)


def test_coax_fields_rejected_for_wrong_feed():
    from awadateki.coax import RG_59, RG_62

    # phasing_coax belongs to the line feed only.
    with pytest.raises(ValueError, match="phasing_coax"):
        _eggbeater(replace(_spec(), feed="balun4", phasing_coax=RG_62), 1.0)
    # match_coax is meaningless for balun4 (the harness matches) but valid for line.
    with pytest.raises(ValueError, match="match_coax"):
        _eggbeater(replace(_spec(), feed="balun4", match_coax=RG_59), 1.0)
    _eggbeater(replace(_spec(), feed="line", match_coax=RG_59), 1.0)
    _eggbeater(replace(_spec(), phasing_coax=RG_62, match_coax=RG_59), 1.0)


def test_segment_count_validated():
    # One tag per side, so past 99 sides loop A's tags would collide with loop
    # B's tag base and mis-wire the phasing line.
    with pytest.raises(ValueError, match="segments"):
        _eggbeater(replace(_spec(), segments=100), 1.0)
    _eggbeater(replace(_spec(), segments=99), 1.0)


def test_loop_offset_clearance_validated():
    # 3 mm conductor needs at least 4.5 mm of loop offset (1.5 diameters).
    with pytest.raises(ValueError, match="loop_offset_mm"):
        _eggbeater(replace(_spec(), loop_offset_mm=4.0), 1.0)
    _eggbeater(replace(_spec(), loop_offset_mm=4.5), 1.0)


def test_loop_must_clear_the_reflector_plane():
    # A full-wave circular loop has radius ~0.167 wavelengths, so spacings below
    # that put its lower half through the reflector; nec2c would solve the
    # shorted structure and report impossibly high gain.
    radials = replace(_spec(), reflector="radials", loop_shape="circle")
    with pytest.raises(DesignInfeasible, match="below the reflector plane"):
        _eggbeater(replace(radials, reflector_spacing_wl=0.15), 1.05)
    _eggbeater(replace(radials, reflector_spacing_wl=0.25), 1.05)
    # A ground plane is the same constraint; free space has no plane to hit.
    with pytest.raises(DesignInfeasible, match="below the reflector plane"):
        _eggbeater(
            replace(radials, reflector="ground", reflector_spacing_wl=0.15), 1.05
        )
    _eggbeater(replace(radials, reflector="none", reflector_spacing_wl=0.15), 1.05)


def test_loop_segments_derive_from_conductor():
    from awadateki.conductor import strip_conductor
    from awadateki.design import (
        LOOP_SEGMENT_RADII,
        MIN_LOOP_SEGMENTS,
        loop_segments,
    )
    from awadateki.geometry import wavelength_m

    # An explicit count is passed through untouched.
    assert loop_segments(replace(_spec(), segments=36)) == 36

    # A square has straight sides, so only the conductor-radius target applies and
    # the derived segment length lands near LOOP_SEGMENT_RADII radii. Curved
    # outlines carry an extra geometric floor -- see
    # test_derived_segments_track_the_shape.
    square = replace(
        _spec(),
        freq_mhz=145.0,
        conductor=strip_conductor(10.0),
        loop_shape="square",
        segments=None,
    )
    assert loop_segments(square) == 24
    segment_m = wavelength_m(145.0) / loop_segments(square)
    radii = segment_m / square.conductor.equivalent_radius_m
    assert abs(radii - LOOP_SEGMENT_RADII) < 3.0

    # A thicker conductor at a higher band asks for fewer sides, which is the
    # whole point: a fixed count would leave the two bands incomparable.
    coarse = loop_segments(
        replace(
            _spec(),
            freq_mhz=435.0,
            conductor=round_conductor(4.0),
            loop_shape="square",
            segments=None,
        )
    )
    assert coarse < 24
    assert coarse >= MIN_LOOP_SEGMENTS
    # Never below the polygon floor, however thick the conductor.
    thick = replace(
        _spec(),
        freq_mhz=435.0,
        conductor=round_conductor(20.0),
        loop_shape="square",
        segments=None,
    )
    assert loop_segments(thick) == MIN_LOOP_SEGMENTS


def test_derived_segments_track_the_shape():
    from awadateki.design import MIN_LOOP_SEGMENTS, loop_segments

    def sides(shape: str, **extra) -> int:
        extra.setdefault("conductor", round_conductor(5.0))
        return loop_segments(
            replace(_spec(), freq_mhz=145.9, loop_shape=shape, segments=None, **extra)
        )

    square = sides("square")
    circle = sides("circle")
    squircle = sides("squircle", corner_radius_wl=0.05)
    # A square's straight sides are exact at any multiple of the quantum, so only
    # the conductor-radius target applies; a circle has to track a curve; and a
    # squircle needs the most, because its curvature is concentrated in four
    # tight corners while segments are spread evenly along the perimeter.
    assert square < circle < squircle
    # Each is a whole number of quantums.
    assert all(n % 4 == 0 for n in (square, circle, squircle))
    # A conductor thick enough to want fewer sides still gets the polygon floor.
    assert sides("circle", conductor=round_conductor(40.0)) == MIN_LOOP_SEGMENTS


def test_secant_reports_its_residual():
    # Converged: the residual is within tolerance.
    root, residual = _secant(lambda x: x - 2.0, 0.0, 1.0, (0.0, 5.0), 1e-6)
    assert math.isclose(root, 2.0, abs_tol=1e-6)
    assert abs(residual) <= 1e-6
    # No root in bounds: the iterate pins at a bound and the residual stays
    # large, which is what lets the caller reject it instead of trusting it.
    root, residual = _secant(lambda x: x + 10.0, 0.0, 1.0, (0.0, 5.0), 1e-6)
    assert abs(residual) > 1e-6


def test_bandwidth_interpolates_edges():
    pairs = [(100.0, 3.0), (101.0, 1.5), (102.0, 1.0), (103.0, 1.5), (104.0, 3.0)]
    low, high = bandwidth_within(pairs, 2.0)
    assert math.isclose(low, 100.667, abs_tol=1e-3)
    assert math.isclose(high, 103.333, abs_tol=1e-3)


def test_bandwidth_none_when_center_mismatched():
    pairs = [(100.0, 3.0), (101.0, 2.5), (102.0, 2.2)]
    assert bandwidth_within(pairs, 2.0) is None


@needs_nec2c
def _cone_result(worst: float, mean: float) -> DesignResult:
    # A tuned result at ~50 ohm (so VSWR is negligible) with independently set
    # cone-mean and cone-worst axial ratios, to probe the optimizer objective.
    return DesignResult(
        spec=replace(_spec(), reflector="radials", ar_margin_db=0.5),
        base_factor=1.05,
        z_in=complex(50.0, 0.0),
        phase_diff_deg=90.0,
        loop_balance=1.0,
        crossed_phasing_line=False,
        sense="RIGHT",
        ar_boresight_db=mean,
        ar_cone_worst_db=worst,
        ar_peak_db=0.5,
        coverage_gain_db=0.0,
        deck="",
    )


def test_placement_cost_uses_worst_cone_ar():
    # Mean is identical; only the worst-case cone AR differs, so it alone must
    # drive the placement cost (worst 4.0 costs more than worst 2.0).
    over = _cone_result(worst=4.0, mean=1.0)
    under = _cone_result(worst=2.0, mean=1.0)
    assert _reflector_cost(over) > _reflector_cost(under)


def test_knee_count_stops_at_diminishing_returns():
    counts = (3, 4, 6, 8)
    # A 0.43 dB step (3->4) is worth it; the 0.12 dB step (4->6) is not: keep 4.
    assert _knee_count(counts, {3: 3.20, 4: 2.77, 6: 2.65, 8: 2.66}) == 4
    # Curve flat from the start: the fewest count wins outright.
    assert _knee_count(counts, {3: 2.59, 4: 2.50, 6: 2.45, 8: 2.50}) == 3
    # Every step still buys >= AR_KNEE_DB: walk to the largest count.
    assert _knee_count(counts, {3: 5.0, 4: 4.5, 6: 4.0, 8: 3.5}) == 8
    # A marginal count sitting at the budget loses to the next with real
    # headroom (0.33 dB), so we do not sit at the edge.
    assert _knee_count(counts, {3: 3.00, 4: 2.67, 6: 2.60, 8: 2.59}) == 4
    # A single count (e.g. a ground reflector) is returned as-is.
    assert _knee_count((4,), {4: 3.5}) == 4


def test_optimize_reflector_returns_spec_with_provenance():
    base = replace(_spec(), reflector="radials")
    best = optimize_reflector(base)
    assert isinstance(best, DesignSpec)
    # Coordinate descent returns continuous values within the search bounds.
    assert 0.15 <= best.reflector_spacing_wl <= 0.40
    assert 0.0 <= best.radial_droop_deg <= 50.0
    assert best.radial_count in (3, 4, 6, 8)
    # Output records its input, search params, and runtime.
    assert best.optimization is not None
    assert best.optimization.input == base
    assert best.optimization.method.startswith("coordinate descent")
    assert best.optimization.radial_count_grid == (3, 4, 6, 8)
    assert best.optimization.elapsed_s >= 0.0
    # Apart from the reflector geometry and the provenance, the spec is unchanged.
    stripped = replace(
        best,
        reflector_spacing_wl=base.reflector_spacing_wl,
        radial_droop_deg=base.radial_droop_deg,
        radial_count=base.radial_count,
        optimization=None,
    )
    assert stripped == base


@needs_nec2c
def test_emit_spec_after_optimize_round_trips(tmp_path):
    from awadateki.spec import specs_from_json

    src = tmp_path / "in.json"
    src.write_text(
        '{"freq_mhz":145.9,"conductor":{"kind":"round","diameter_mm":5},'
        '"reflector":"radials","segments":16,"label":"2 m"}'
    )
    out = tmp_path / "optimized.json"
    assert main([str(src), "--optimize-reflector", "--emit-spec", str(out)]) == 0
    baked = specs_from_json(out.read_text())
    assert len(baked) == 1
    assert 0.15 <= baked[0].reflector_spacing_wl <= 0.40
    assert baked[0].label == "2 m"


@needs_nec2c
def test_frequency_sweep_reports_both_bandwidths():
    result = design(replace(_spec(), reflector="ground"))
    sweep = frequency_sweep(result, span_fraction=0.05, points=11)
    center = result.spec.freq_mhz
    vswr_band = bandwidth_within([(p.freq_mhz, p.vswr) for p in sweep], VSWR_LIMIT)
    ar_band = bandwidth_within([(p.freq_mhz, p.ar_db) for p in sweep], AR_TARGET_DB)
    assert vswr_band is not None
    assert ar_band is not None
    assert vswr_band[0] <= center <= vswr_band[1]
    assert ar_band[0] <= center <= ar_band[1]


@needs_nec2c
def test_cut_sheet_labels_keep_a_space_before_the_colon():
    """The labels are hand-aligned literals, so the longest one silently filled
    the column and butted against its colon. Every value row is checked rather
    than the four that were wrong."""
    spec = DesignSpec(
        freq_mhz=145.9,
        conductor=round_conductor(5.0),
        reflector=REFLECTOR_RADIALS,
        segments=16,
    )
    from awadateki.report import format_cut_sheet

    for line in format_cut_sheet(design(spec)).splitlines():
        match = re.match(r"^(?P<label>[^:!]*?)(?P<pad>\s*): \S", line)
        if match is None or not match.group("label").strip():
            continue  # section header, warning, or continuation
        assert match.group("pad"), f"no space before the colon: {line!r}"
