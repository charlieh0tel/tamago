import json
import math

from awadateki.conductor import round_conductor
from awadateki.design import DesignResult, DesignSpec
from awadateki.result import result_to_dict, results_to_json


def _result(**spec_overrides) -> DesignResult:
    fields = dict(
        freq_mhz=145.9,
        conductor=round_conductor(5.0),
        reflector="radials",
        radial_droop_deg=40.0,
    )
    fields.update(spec_overrides)
    spec = DesignSpec(**fields)
    return DesignResult(
        spec=spec,
        base_factor=1.05,
        z_in=complex(112.5, -16.0),
        phase_diff_deg=88.0,
        loop_balance=1.1,
        crossed_phasing_line=False,
        sense="RIGHT",
        ar_boresight_db=1.3,
        ar_cone_worst_db=2.4,
        ar_peak_db=0.7,
        coverage_gain_db=0.34,
        deck="",
    )


def test_build_and_performance_sections():
    data = result_to_dict(_result())
    assert set(data) == {"spec", "build", "performance"}
    build = data["build"]
    assert "large_loop" not in build
    assert build["loop"]["perimeter_mm"] > 0.0
    assert build["phasing_line"]["length_mm"] > 0.0
    assert build["phasing_line"]["coax"]["name"] == "RG-62"
    assert build["phasing_line"]["coax"]["z0_ohm"] == 93.0
    assert build["phasing_line"]["connection"] == "normal"
    assert build["feed_gap_mm"] == 10.0
    assert build["radials"]["count"] == 8
    # Capacitive feed (-16j) is canceled by a series inductor.
    assert build["match"]["series_element"]["kind"] == "inductor"
    # 112.5 ohm to 50 ohm wants a 75 ohm transformer: RG-59 from the catalog.
    assert build["match"]["transformer_coax"]["name"] == "RG-59"
    perf = data["performance"]
    assert perf["feed_z_kind"] == "feedpoint"
    assert perf["loop_balance"] == 1.1
    assert perf["axial_ratio_cone_worst_db"] == 2.4
    assert perf["coverage_gain_dbi"] == 0.34
    assert perf["sense"] == "RHCP"
    assert perf["sense_achieved"] is True


def test_balun4_build_sections():
    data = result_to_dict(_result(feed="balun4"))
    build = data["build"]
    harness = build["harness"]
    # The F5VIF balanced system: 100 ohm balanced pair for the phasing line
    # and Q-section, a half-wave RG-58 hairpin for the 4:1 balun.
    assert harness["phasing_line"]["coax"]["name"] == "2x RG-58 (balanced)"
    assert harness["phasing_line"]["coax"]["z0_ohm"] == 100.0
    assert harness["q_section"]["coax"]["name"] == "2x RG-58 (balanced)"
    assert harness["balun"]["kind"] == "half-wave 4:1"
    assert harness["balun"]["coax"]["name"] == "RG-58"
    # Half wave of RG-58 is twice the quarter-wave phasing-line cut at the
    # same velocity factor.
    assert math.isclose(
        harness["balun"]["length_mm"], 2.0 * harness["phasing_line"]["length_mm"]
    )
    assert build["match"] == {"system_z_ohm": 50.0, "network": "harness"}


def test_bandwidth_absent_unless_requested():
    assert "bandwidth" not in result_to_dict(_result())


def test_results_to_json_single_is_object():
    assert isinstance(json.loads(results_to_json([_result()])), dict)


def test_results_to_json_list():
    payload = json.loads(results_to_json([_result(), _result(freq_mhz=436.0)]))
    assert isinstance(payload, list)
    assert len(payload) == 2
