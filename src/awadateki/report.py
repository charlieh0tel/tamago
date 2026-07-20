"""Text reports: the physical cut sheet and the frequency-sweep bandwidths.

Shared by the CLI and the plot page so both render identical numbers.
"""

from .design import (
    AR_TARGET_DB,
    BORESIGHT_THETA_DEG,
    COVERAGE_THETA_DEG,
    NEC_SENSE_TO_HAND,
    VSWR_LIMIT,
    DesignResult,
    bandwidth_within,
    frequency_sweep,
)
from .result import result_to_dict

# Shape-appropriate label for the loop's across dimension (width_mm).
_WIDTH_TERM = {"circle": "dia", "square": "side", "squircle": "width"}


def _format_sense(result: DesignResult) -> str:
    """Achieved polarization sense, flagging any mismatch with the request."""
    achieved = NEC_SENSE_TO_HAND.get(result.sense)
    if achieved is None:
        return f"{result.sense} (requested {result.spec.sense})"
    if achieved == result.spec.sense:
        return achieved.upper()
    return f"{achieved.upper()} (requested {result.spec.sense.upper()} not achieved)"


def _header_lines(result: DesignResult, build: dict) -> list[str]:
    spec = result.spec
    title = (
        f"Eggbeater cut sheet: {spec.label}" if spec.label else "Eggbeater cut sheet"
    )
    lines = [
        title,
        "=" * 40,
        f"Frequency           : {build['freq_mhz']:.4g} MHz",
        f"Wavelength          : {build['wavelength_mm']:.1f} mm",
        f"Conductor           : {spec.conductor.description}",
        f"  equivalent radius : {spec.conductor.equivalent_radius_mm:.4g} mm",
        f"Loop shape          : {build['loop_shape']}",
        f"Reflector           : {build['reflector']}",
    ]
    if "corner_radius_mm" in build:
        lines.append(f"  corner radius     : {build['corner_radius_mm']:.1f} mm")
    if "loop_center_height_mm" in build:
        lines.append(
            f"  loop-center height: {build['loop_center_height_wl']:.3g} wl "
            f"({build['loop_center_height_mm']:.1f} mm)"
        )
    if "radials" in build:
        radials = build["radials"]
        lines.append(
            f"  radials           : {radials['count']} x "
            f"{radials['length_mm']:.1f} mm, {radials['droop_deg']:g} deg droop"
        )
    return lines


def _coax_text(piece: dict) -> str:
    coax = piece["coax"]
    return (
        f"{piece['length_mm']:.1f} mm ({coax['name']}, "
        f"{coax['z0_ohm']:g} ohm, 1/4 wave, VF {coax['vf']:g})"
    )


def _feed_lines(build: dict) -> list[str]:
    if "phasing_line" in build:
        line = build["phasing_line"]
        return [
            f"Phasing line        : {_coax_text(line)}",
            f"Feed                : feedline (via match) to junction across "
            f"loop A; {line['connection']} line to loop B",
        ]
    harness = build["harness"]
    balun = harness["balun"]
    if "phasing_line" in harness:
        # The F5VIF balanced system (balun4).
        return [
            f"Phasing line        : {_coax_text(harness['phasing_line'])}",
            f"Q-section           : {_coax_text(harness['q_section'])}",
            "Pair braids         : bonded to each other at both ends; not grounded",
            f"Balun               : {balun['kind']}, {balun['length_mm']:.1f} mm "
            f"{balun['coax']['name']} (VF {balun['coax']['vf']:g}); braid bonds "
            "to the feedline braid",
            f"Feed                : balun then Q-section to the junction across "
            f"loop A; {harness['connection']} phasing line to loop B",
        ]
    return [
        f"Q-sections          : 2 x {_coax_text(harness['q_section'])}",
        f"Delay line          : {_coax_text(harness['delay_line'])} in the loop B leg",
        f"Balun               : {balun['kind']} at the radio",
        f"Feed                : Q-section legs joined at the harness port; "
        f"{harness['connection']} Q-section to loop B",
    ]


def _geometry_lines(result: DesignResult, build: dict) -> list[str]:
    term = _WIDTH_TERM.get(build["loop_shape"], "width")
    loop = build["loop"]
    return [
        f"Both loops          : {loop['perimeter_mm']:.1f} mm perimeter, "
        f"{loop['width_mm']:.1f} mm {term}",
        f"Loop offset         : {build['loop_offset_mm']:g} mm (loop A below, "
        "loop B above)",
        f"Feed gap            : {build['feed_gap_mm']:g} mm at each loop bottom",
    ] + _feed_lines(build)


def _match_lines(result: DesignResult, build: dict) -> list[str]:
    match = build["match"]
    lines = [f"Match to {match['system_z_ohm']:g} ohm:"]
    if match.get("network") == "harness":
        lines.append("  via the harness Q-section and 4:1 balun (see above)")
        return lines
    series = match["series_element"]
    if series is not None:
        sized = (
            f"{series['value_pf']:.1f} pF"
            if series["kind"] == "capacitor"
            else f"{series['value_nh']:.0f} nH"
        )
        lines.append(
            f"  series {series['kind']:9}  : {sized} to cancel "
            f"{result.z_in.imag:+.0f}j ohms"
        )
    coax = match["transformer_coax"]
    lines += [
        f"  1/4-wave Z0       : {match['transformer_z0_ohm']:.1f} ohms "
        f"(use {coax['name']}, {coax['z0_ohm']:g} ohm)",
        f"  1/4-wave length   : {match['transformer_length_mm']:.1f} mm "
        f"(VF {coax['vf']:g})",
    ]
    return lines


def _performance_lines(result: DesignResult, perf: dict) -> list[str]:
    z = perf["feed_z_ohm"]
    return [
        "Predicted performance:",
        f"  feedpoint Z      : {z['real']:.1f} {z['imag']:+.1f}j ohms",
        f"  VSWR (unmatched) : {perf['vswr_unmatched']:.2f}",
        f"  loop current phase: {perf['loop_current_phase_deg']:+.1f} deg "
        "(target +/-90)",
        f"  loop balance     : {perf['loop_balance']:.3f} |Ib/Ia| (1.0 = equal drive)",
        f"  polarization sense: {_format_sense(result)}",
        f"  axial ratio (cone): {perf['axial_ratio_cone_db']:.2f} dB mean, "
        f"{perf['axial_ratio_cone_worst_db']:.2f} dB worst "
        f"(<= {int(BORESIGHT_THETA_DEG)} deg from zenith)",
        f"  axial ratio (peak): {perf['axial_ratio_peak_db']:.2f} dB",
        f"  coverage gain     : {perf['coverage_gain_dbi']:.2f} dBi "
        f"(worst case <= {int(COVERAGE_THETA_DEG)} deg from zenith)",
    ]


def _build_lines(result: DesignResult, build: dict) -> list[str]:
    lines = _header_lines(result, build)
    lines.append("-" * 40)
    lines += _geometry_lines(result, build)
    lines.append("-" * 40)
    lines += _match_lines(result, build)
    return lines


def cut_sheet_build(result: DesignResult) -> str:
    """Buildable cut list only: dimensions and the matching hardware."""
    build = result_to_dict(result)["build"]
    return "\n".join(_build_lines(result, build)) + "\n"


def format_cut_sheet(result: DesignResult) -> str:
    """Full cut sheet: the build cut list plus the predicted performance."""
    data = result_to_dict(result)
    lines = _build_lines(result, data["build"])
    lines.append("-" * 40)
    lines += _performance_lines(result, data["performance"])
    return "\n".join(lines) + "\n"


def _band_line(label: str, band: tuple[float, float] | None, center: float) -> str:
    """One bandwidth line, or a not-met note when the band is empty."""
    if band is None:
        return f"  {label:18}: not met at the design frequency"
    low, high = band
    width = high - low
    return (
        f"  {label:18}: {low:.2f} - {high:.2f} MHz "
        f"({width:.2f} MHz, {100 * width / center:.1f} %)"
    )


def format_bandwidth(result: DesignResult) -> str:
    """Run a frequency sweep and render the VSWR and axial-ratio bandwidths."""
    sweep = frequency_sweep(result)
    center = result.spec.freq_mhz
    vswr_band = bandwidth_within([(p.freq_mhz, p.vswr) for p in sweep], VSWR_LIMIT)
    ar_band = bandwidth_within([(p.freq_mhz, p.ar_db) for p in sweep], AR_TARGET_DB)
    lines = [
        "-" * 40,
        f"Frequency sweep ({len(sweep)} points):",
        _band_line(f"{VSWR_LIMIT:g}:1 VSWR", vswr_band, center),
        _band_line(f"{AR_TARGET_DB:g} dB axial ratio", ar_band, center),
    ]
    return "\n".join(lines) + "\n"
