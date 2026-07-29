"""Regenerate the golden reference files for the tamago TypeScript port.

Each case below is a DesignSpec exercised through the Python awadateki
pipeline (the source of truth). For every case this writes:

    <name>.spec.json      spec_to_dict(spec), the canonical spec JSON.
    <name>.deck.nec       _build_deck_text(spec, 1.05, False, None, None):
                          the pure-geometry deck at a fixed perimeter factor
                          (no tuning, no nec2c run) -- deterministic byte-
                          for-byte given the geometry code alone.
    <name>.deck-flipped.nec  same, with flip=True (crossed line connection);
                          emitted for exactly one lhcp case (see CASES).
    <name>.result.json    result_to_dict(design(spec)): the tuned design.
    <name>.cutsheet.txt   format_cut_sheet(design(spec)): the text report.

manifest.json lists every case with a few key tuned numbers pulled from the
result, plus the git commit this was generated from.

Run with: uv run python web/goldens/generate.py
Deterministic: nec2c and this pipeline have no randomness, so re-running
produces byte-identical output (verified by running twice and diffing).
"""

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from awadateki.coax import RG_58, RG_59  # noqa: E402
from awadateki.conductor import bar_conductor, round_conductor  # noqa: E402
from awadateki.design import (  # noqa: E402
    FEED_BALUN4,
    FEED_CHOKE,
    FEED_LINE,
    REFLECTOR_GROUND,
    REFLECTOR_NONE,
    REFLECTOR_RADIALS,
    SENSE_LHCP,
    SENSE_RHCP,
    DesignSpec,
    _build_deck_text,
    design,
)
from awadateki.geometry import SHAPE_CIRCLE, SHAPE_SQUARE, SHAPE_SQUIRCLE  # noqa: E402
from awadateki.report import format_cut_sheet  # noqa: E402
from awadateki.result import result_to_dict  # noqa: E402
from awadateki.spec import spec_to_dict  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent

# Fixed perimeter factor for the pure-geometry deck golden (no tuning).
GEOMETRY_FACTOR = 1.05

# Speed knobs: most cases run at a reduced segment count; a couple of cases
# pin the library default (36) to exercise that path too.
FAST_SEGMENTS = 16
FULL_SEGMENTS = 36

BAND_2M = 145.9
BAND_70CM = 436.0

ROUND_5MM = round_conductor(5.0)
BAR_6X3MM = bar_conductor(6.0, 3.0)


def _spec(name: str, **kwargs) -> tuple[str, DesignSpec]:
    kwargs.setdefault("conductor", ROUND_5MM)
    kwargs.setdefault("segments", FAST_SEGMENTS)
    return name, DesignSpec(**kwargs)


# Case matrix: (name, spec, emit_flipped_deck). Names encode feed, reflector,
# shape, sense, and band so a mismatch is obvious from the filename alone.
CASES: list[tuple[str, DesignSpec, bool]] = [
    (
        *_spec(
            "line_none_circle_rhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_circle_lhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_LHCP,
        ),
        True,  # also emit the flipped (crossed-line) deck for this one
    ),
    (
        *_spec(
            "line_ground_circle_rhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_GROUND,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "line_radials_circle_rhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_RADIALS,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "line_radials_droop_circle_rhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_RADIALS,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
            radial_count=4,
            radial_droop_deg=25.0,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_square_rhcp_70cm",
            freq_mhz=BAND_70CM,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_SQUARE,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_squircle_rhcp_70cm",
            freq_mhz=BAND_70CM,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_SQUIRCLE,
            corner_radius_wl=0.08,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_circle_rhcp_2m_matchcoax",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
            match_coax=RG_59,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_circle_rhcp_2m_phasingcoax",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
            phasing_coax=RG_58,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_circle_rhcp_2m_bar",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
            conductor=BAR_6X3MM,
        ),
        False,
    ),
    (
        *_spec(
            "balun4_none_circle_rhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_BALUN4,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "balun4_none_circle_lhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_BALUN4,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_LHCP,
        ),
        False,
    ),
    (
        *_spec(
            "balun4_radials_squircle_rhcp_70cm",
            freq_mhz=BAND_70CM,
            feed=FEED_BALUN4,
            reflector=REFLECTOR_RADIALS,
            loop_shape=SHAPE_SQUIRCLE,
            corner_radius_wl=0.08,
            sense=SENSE_RHCP,
            conductor=BAR_6X3MM,
        ),
        False,
    ),
    (
        *_spec(
            "choke_none_circle_rhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_CHOKE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
        ),
        False,
    ),
    (
        *_spec(
            "choke_none_circle_lhcp_2m",
            freq_mhz=BAND_2M,
            feed=FEED_CHOKE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_LHCP,
        ),
        False,
    ),
    (
        *_spec(
            "choke_radials_squircle_rhcp_70cm",
            freq_mhz=BAND_70CM,
            feed=FEED_CHOKE,
            reflector=REFLECTOR_RADIALS,
            loop_shape=SHAPE_SQUIRCLE,
            corner_radius_wl=0.08,
            sense=SENSE_RHCP,
            conductor=BAR_6X3MM,
        ),
        False,
    ),
    (
        *_spec(
            "line_none_circle_rhcp_2m_full36",
            freq_mhz=BAND_2M,
            feed=FEED_LINE,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
            segments=FULL_SEGMENTS,
        ),
        False,
    ),
    (
        *_spec(
            "balun4_none_circle_rhcp_2m_full36",
            freq_mhz=BAND_2M,
            feed=FEED_BALUN4,
            reflector=REFLECTOR_NONE,
            loop_shape=SHAPE_CIRCLE,
            sense=SENSE_RHCP,
            segments=FULL_SEGMENTS,
        ),
        False,
    ),
]


def _git_short_hash() -> str:
    return subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=Path(__file__).resolve().parents[2],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> None:
    manifest_cases = []
    for name, spec, emit_flipped in CASES:
        _write_json(OUT_DIR / f"{name}.spec.json", spec_to_dict(spec))

        deck = _build_deck_text(spec, GEOMETRY_FACTOR, False, None, None)
        (OUT_DIR / f"{name}.deck.nec").write_text(deck)
        if emit_flipped:
            flipped = _build_deck_text(spec, GEOMETRY_FACTOR, True, None, None)
            (OUT_DIR / f"{name}.deck-flipped.nec").write_text(flipped)

        result = design(spec)
        result_dict = result_to_dict(result)
        _write_json(OUT_DIR / f"{name}.result.json", result_dict)

        cutsheet = format_cut_sheet(result)
        (OUT_DIR / f"{name}.cutsheet.txt").write_text(cutsheet)

        perf = result_dict["performance"]
        manifest_cases.append(
            {
                "name": name,
                "feed": spec.feed,
                "reflector": spec.reflector,
                "loop_shape": spec.loop_shape,
                "sense": spec.sense,
                "freq_mhz": spec.freq_mhz,
                "conductor_kind": spec.conductor.kind,
                "segments": spec.segments,
                "base_factor": result.base_factor,
                "phase_diff_deg": result.phase_diff_deg,
                "z_in_real": result.z_in.real,
                "z_in_imag": result.z_in.imag,
                "ar_cone_mean_db": perf["axial_ratio_cone_db"],
                "ar_cone_worst_db": perf["axial_ratio_cone_worst_db"],
                "crossed_phasing_line": result.crossed_phasing_line,
                "emits_flipped_deck": emit_flipped,
            }
        )

    manifest = {
        "git_commit": _git_short_hash(),
        "geometry_factor": GEOMETRY_FACTOR,
        "cases": manifest_cases,
    }
    _write_json(OUT_DIR / "manifest.json", manifest)
    print(f"wrote {len(CASES)} cases to {OUT_DIR}")


if __name__ == "__main__":
    main()
