from awadateki.conductor import round_conductor
from awadateki.design import DesignResult, DesignSpec
from awadateki.schematic import render_feed_schematic


def _result(**overrides) -> DesignResult:
    fields = dict(
        spec=DesignSpec(freq_mhz=145.9, conductor=round_conductor(5.0)),
        base_factor=1.05,
        z_in=complex(112.5, -16.0),
        phase_diff_deg=88.0,
        loop_balance=1.1,
        crossed_phasing_line=False,
        sense="RIGHT",
        ar_boresight_db=1.3,
        ar_peak_db=0.7,
        coverage_gain_db=0.34,
        deck="",
    )
    fields.update(overrides)
    return DesignResult(**fields)


def test_schematic_labels_sections_and_loops():
    svg = render_feed_schematic(_result())
    assert svg.startswith('<svg class="sch"')
    # Capacitive feed (-16j): series inductor L1.
    assert ">L1<" in svg
    assert "nH" in svg
    # 112.5 ohm to 50 ohm wants 75 ohm: RG-59 transformer; RG-62 phasing line.
    assert "TL1  RG-59" in svg
    assert "TL2  RG-62" in svg
    assert "LOOP A" in svg and "LOOP B" in svg
    assert "crossed" not in svg


def test_schematic_crossed_connection_marked():
    svg = render_feed_schematic(_result(crossed_phasing_line=True))
    assert "crossed" in svg


def test_schematic_no_series_element_when_reactance_small():
    svg = render_feed_schematic(_result(z_in=complex(112.5, 2.0)))
    assert ">L1<" not in svg and ">C1<" not in svg
