"""Structured, JSON-serializable view of a tuned design.

result_to_dict is the single source of the derived numbers: the build cut list
(loop dimensions and the matching hardware) and the predicted performance. The
text cut sheet renders from this dict and --emit-result writes it verbatim, so
the numbers cannot diverge between outputs.

The result dict has three top-level sections (a fourth, "bandwidth", is added
only when a frequency sweep is requested):

    spec        the input spec (see spec.spec_to_dict).
    build       buildable cut list:
                  freq_mhz, wavelength_mm, loop_shape, reflector;
                  corner_radius_mm present for the squircle shape;
                  loop_center_height_wl/_mm and radials present with a reflector;
                  loop {perimeter_mm, width_mm} (width is the across dimension:
                  diameter, side, or squircle width); loop_offset_mm; feed_gap_mm;
                  feed (line|balun4);
                  phasing_line {coax {name, z0_ohm, vf}, length_mm,
                  connection (normal|crossed)} for the line feed, else
                  harness (balun4: phasing_line, q_section,
                  balun {kind, coax, length_mm}, connection);
                  match: system_z_ohm plus, for the line feed,
                         series_element (null or {kind, value_nh|value_pf}),
                         transformer_z0_ohm (ideal),
                         transformer_coax {name, z0_ohm, vf},
                         transformer_length_mm ("network": "harness" for
                         balun4, whose Q-section and balun do the matching).
    performance feedpoint and pattern figures of merit:
                  feed_z_ohm {real, imag}, feed_z_kind (feedpoint),
                  vswr_unmatched, vswr_matched, loop_current_phase_deg,
                  loop_balance (|I_B|/|I_A|), loop_a_feed_z_ohm and
                  loop_b_feed_z_ohm {real, imag} (active per-loop feedpoint
                  impedance, null if not characterized), sense, sense_requested,
                  sense_achieved, axial_ratio_cone_db (mean),
                  axial_ratio_cone_worst_db, axial_ratio_peak_db,
                  coverage_gain_dbi.
    bandwidth   vswr_2to1_mhz and axial_ratio_3db_mhz, each [low, high] or null.
"""

import json

from .coax import Coax
from .design import (
    AR_TARGET_DB,
    BALUN4_BALUN_COAX,
    BALUN4_PHASING_COAX,
    BALUN4_Q_COAX,
    BALUN_LINE_WL,
    CHOKE_CORE_PN_UHF,
    CHOKE_CORE_PN_VHF,
    CHOKE_FEED_COAX,
    CHOKE_FERRITE_CORES,
    CHOKE_PHASING_COAX,
    CHOKE_UHF_THRESHOLD_MHZ,
    FEED_BALUN4,
    FEED_CHOKE,
    FEED_LINE,
    LOOP_SEGMENT_RADII,
    LOOP_SEGMENT_WL_WARN,
    NEC_SENSE_TO_HAND,
    REFLECTOR_NONE,
    REFLECTOR_RADIALS,
    VSWR_LIMIT,
    DesignResult,
    bandwidth_within,
    frequency_sweep,
    loop_segment_length_m,
    loop_segments,
    match_is_useful,
    matched_vswr,
    phasing_line_coax,
    quarter_wave_match_z0,
    series_element_fitted,
    series_match_element,
    transformer_coax,
    vswr,
)
from .geometry import SHAPE_SQUIRCLE, loop_extent_m, wavelength_m
from .spec import spec_to_dict

MM_PER_M = 1000.0
PF_PER_FARAD = 1.0e12
NH_PER_HENRY = 1.0e9
# Fraction of a wavelength in a quarter-wave line (phasing or transformer).
QUARTER_WAVE = 0.25


def _coax_dict(coax: Coax) -> dict:
    return {"name": coax.name, "z0_ohm": coax.z0_ohm, "vf": coax.vf}


def _quarter_wave_mm(wavelength: float, coax: Coax) -> float:
    """Physical cut length of an electrical quarter wave in the given coax."""
    return QUARTER_WAVE * wavelength * coax.vf * MM_PER_M


def _loop_dims(perimeter_m: float, shape: str, corner_radius_m: float) -> dict:
    return {
        "perimeter_mm": perimeter_m * MM_PER_M,
        "width_mm": loop_extent_m(perimeter_m, shape, corner_radius_m) * MM_PER_M,
    }


def _match_dict(result: DesignResult, wavelength: float) -> dict:
    spec = result.spec
    z = result.z_in
    if spec.feed == FEED_BALUN4:
        # The Q-section and balun in the harness are the match network.
        return {"system_z_ohm": spec.system_z_ohm, "network": "harness"}
    if spec.feed == FEED_CHOKE:
        # A 1:1 ferrite choke: no impedance transform, the radio sees z_in.
        return {"system_z_ohm": spec.system_z_ohm, "network": "choke"}
    if not match_is_useful(spec, z):
        # The junction already sits at the system impedance; a transformer here
        # would be an inert section of coax.
        return {"system_z_ohm": spec.system_z_ohm, "network": "direct"}
    z0 = quarter_wave_match_z0(z, spec.system_z_ohm)
    coax = transformer_coax(z, spec.system_z_ohm, spec.match_coax)
    series = None
    if series_element_fitted(z):
        kind, value = series_match_element(z, spec.freq_mhz)
        series = {"kind": kind}
        if kind == "capacitor":
            series["value_pf"] = value * PF_PER_FARAD
        else:
            series["value_nh"] = value * NH_PER_HENRY
    return {
        "system_z_ohm": spec.system_z_ohm,
        "series_element": series,
        "transformer_z0_ohm": z0,
        "transformer_coax": _coax_dict(coax),
        "transformer_length_mm": _quarter_wave_mm(wavelength, coax),
    }


def _harness_dict(result: DesignResult, wavelength: float) -> dict:
    """Harness pieces for the balanced feeds (balun4 and choke)."""
    spec = result.spec
    connection = "crossed" if result.crossed_phasing_line else "normal"
    if spec.feed == FEED_CHOKE:
        core_pn = (
            CHOKE_CORE_PN_UHF
            if spec.freq_mhz >= CHOKE_UHF_THRESHOLD_MHZ
            else CHOKE_CORE_PN_VHF
        )
        return {
            "phasing_line": {
                "coax": _coax_dict(CHOKE_PHASING_COAX),
                "length_mm": _quarter_wave_mm(wavelength, CHOKE_PHASING_COAX),
            },
            "balun": {
                "kind": "1:1 ferrite choke",
                "coax": _coax_dict(CHOKE_FEED_COAX),
                "cores": CHOKE_FERRITE_CORES,
                "core_pn": core_pn,
            },
            "connection": connection,
        }
    return {
        "phasing_line": {
            "coax": _coax_dict(BALUN4_PHASING_COAX),
            "length_mm": _quarter_wave_mm(wavelength, BALUN4_PHASING_COAX),
        },
        "q_section": {
            "coax": _coax_dict(BALUN4_Q_COAX),
            "length_mm": _quarter_wave_mm(wavelength, BALUN4_Q_COAX),
        },
        "balun": {
            "kind": "half-wave 4:1",
            "coax": _coax_dict(BALUN4_BALUN_COAX),
            "length_mm": BALUN_LINE_WL * wavelength * BALUN4_BALUN_COAX.vf * MM_PER_M,
        },
        "connection": connection,
    }


def _mesh_dict(result: DesignResult, wavelength: float) -> dict:
    """NEC discretization and the two ratios that bound its validity.

    segment_radii is the binding one for the loop impedance (the thin-wire
    kernel), and segment_wl is the one that bounds current resolution. A thick
    conductor cannot satisfy both, so both are reported rather than enforced;
    see docs/segmentation.md.
    """
    spec = result.spec
    sides = loop_segments(spec)
    segment_m = loop_segment_length_m(spec, result.base_factor * wavelength)
    return {
        "loop_segments": sides,
        "derived": spec.segments is None,
        "segment_length_mm": segment_m * MM_PER_M,
        "segment_wl": segment_m / wavelength,
        "segment_radii": segment_m / spec.conductor.equivalent_radius_m,
        "segment_radii_target": LOOP_SEGMENT_RADII,
        "segment_wl_warn": LOOP_SEGMENT_WL_WARN,
    }


def _build_dict(result: DesignResult) -> dict:
    spec = result.spec
    wavelength = wavelength_m(spec.freq_mhz)
    build = {
        "freq_mhz": spec.freq_mhz,
        "wavelength_mm": wavelength * MM_PER_M,
        "loop_shape": spec.loop_shape,
        "reflector": spec.reflector,
    }
    if spec.reflector != REFLECTOR_NONE:
        build["loop_center_height_wl"] = spec.reflector_spacing_wl
        height_mm = spec.reflector_spacing_wl * wavelength * MM_PER_M
        build["loop_center_height_mm"] = height_mm
    if spec.reflector == REFLECTOR_RADIALS:
        build["radials"] = {
            "count": spec.radial_count,
            "length_mm": spec.radial_length_wl * wavelength * MM_PER_M,
            "droop_deg": spec.radial_droop_deg,
        }
    shape = spec.loop_shape
    corner_radius_m = (
        spec.corner_radius_wl * wavelength if shape == SHAPE_SQUIRCLE else 0.0
    )
    if shape == SHAPE_SQUIRCLE:
        build["corner_radius_mm"] = corner_radius_m * MM_PER_M
    build["loop"] = _loop_dims(result.base_factor * wavelength, shape, corner_radius_m)
    build["mesh"] = _mesh_dict(result, wavelength)
    build["loop_offset_mm"] = spec.loop_offset_mm
    build["feed_gap_mm"] = spec.feed_gap_mm
    build["feed"] = spec.feed
    if spec.feed == FEED_LINE:
        build["phasing_line"] = {
            "coax": _coax_dict(phasing_line_coax(spec)),
            "length_mm": _quarter_wave_mm(wavelength, phasing_line_coax(spec)),
            "connection": "crossed" if result.crossed_phasing_line else "normal",
        }
    else:
        build["harness"] = _harness_dict(result, wavelength)
    build["match"] = _match_dict(result, wavelength)
    return build


def _z_ohm(z: complex | None) -> dict | None:
    return {"real": z.real, "imag": z.imag} if z is not None else None


def _performance_dict(result: DesignResult) -> dict:
    spec = result.spec
    z = result.z_in
    achieved = NEC_SENSE_TO_HAND.get(result.sense)
    return {
        "feed_z_ohm": {"real": z.real, "imag": z.imag},
        "feed_z_kind": "feedpoint",
        "vswr_unmatched": vswr(z, spec.system_z_ohm),
        "vswr_matched": matched_vswr(spec, z),
        "loop_current_phase_deg": result.phase_diff_deg,
        "loop_balance": result.loop_balance,
        "loop_a_feed_z_ohm": _z_ohm(result.loop_a_feed_z),
        "loop_b_feed_z_ohm": _z_ohm(result.loop_b_feed_z),
        "sense": (achieved.upper() if achieved else result.sense),
        "sense_requested": spec.sense.upper(),
        "sense_achieved": achieved == spec.sense,
        "axial_ratio_cone_db": result.ar_boresight_db,
        "axial_ratio_cone_worst_db": result.ar_cone_worst_db,
        "axial_ratio_peak_db": result.ar_peak_db,
        "coverage_gain_dbi": result.coverage_gain_db,
    }


def _bandwidth_dict(result: DesignResult) -> dict:
    sweep = frequency_sweep(result)
    vswr_band = bandwidth_within([(p.freq_mhz, p.vswr) for p in sweep], VSWR_LIMIT)
    ar_band = bandwidth_within([(p.freq_mhz, p.ar_db) for p in sweep], AR_TARGET_DB)
    return {
        "vswr_2to1_mhz": list(vswr_band) if vswr_band else None,
        "axial_ratio_3db_mhz": list(ar_band) if ar_band else None,
    }


def result_to_dict(result: DesignResult, bandwidth: bool = False) -> dict:
    """Serialize a tuned design's cut list and performance to a plain dict.

    The frequency sweep (extra nec2c runs) is done only when bandwidth is set.
    """
    data = {
        "spec": spec_to_dict(result.spec),
        "build": _build_dict(result),
        "performance": _performance_dict(result),
    }
    if bandwidth:
        data["bandwidth"] = _bandwidth_dict(result)
    return data


def results_to_json(results: list[DesignResult], bandwidth: bool = False) -> str:
    """Serialize results to JSON; a single result becomes an object, not a list."""
    payload = [result_to_dict(r, bandwidth) for r in results]
    return json.dumps(payload[0] if len(payload) == 1 else payload, indent=2)
