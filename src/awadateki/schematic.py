"""Canonical feed/match schematic, rendered as inline SVG line art.

Classic two-conductor schematic drawing (handbook style): open-circle
terminals, inductor humps / capacitor plates, coax sections drawn as a shield
cylinder with circular end faces around the centre conductor (shield pigtails
to the return at each end), filled junction dots, a hop where conductors cross
without connecting, and full-wave loops drawn as a circle broken at the feed
gap. A crossed phasing line is drawn as an actual conductor swap.

The numbers come from result_to_dict()["build"], the same source as the cut
sheet, so the drawing cannot diverge from the other outputs. The symbol
helpers are topology-independent; _line_phased() lays out today's feed and a
future self-phased or balun-fed variant adds its own layout over the same
symbols.
"""

import math

from .design import DesignResult
from .result import result_to_dict

# Conductor pair geometry: the hot rail runs RAIL_GAP above the return rail.
RAIL_GAP = 40.0
# Half-angle of the feed-gap break in a loop symbol, degrees.
LOOP_GAP_DEG = 25.0
LOOP_RADIUS = 42.0
# Coax shield cylinder: half-height around the centre conductor, and the
# radius of the circular end faces.
COAX_RY = 8.0
TERMINAL_RADIUS = 3.5
DOT_RADIUS = 3.0
HOP_RADIUS = 7.0


def _text(x: float, y: float, s: str, anchor: str = "middle") -> str:
    return f'<text x="{x:.0f}" y="{y:.0f}" text-anchor="{anchor}">{s}</text>'


def _line(x1: float, y1: float, x2: float, y2: float) -> str:
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"/>'


def _dot(x: float, y: float) -> str:
    return f'<circle class="dot" cx="{x:.1f}" cy="{y:.1f}" r="{DOT_RADIUS}"/>'


def _terminal_pair(x: float, y_top: float) -> str:
    """Open-circle terminal on each conductor (the feedline attachment)."""
    return (
        f'<circle cx="{x:.1f}" cy="{y_top:.1f}" r="{TERMINAL_RADIUS}"/>'
        f'<circle cx="{x:.1f}" cy="{y_top + RAIL_GAP:.1f}" r="{TERMINAL_RADIUS}"/>'
    )


def _inductor(x0: float, x1: float, y: float) -> str:
    """Series inductor in a conductor: four semicircular humps."""
    humps = 4
    r = (x1 - x0) / (2.0 * humps)
    arcs = "".join(f"a{r:.1f},{r:.1f} 0 0 1 {2 * r:.1f},0" for _ in range(humps))
    return f'<path d="M{x0:.1f},{y:.1f} {arcs}"/>'


def _capacitor(x0: float, x1: float, y: float) -> str:
    """Series capacitor in a conductor: two plates with a gap."""
    mid = (x0 + x1) / 2.0
    half_gap = 4.0
    plate = 11.0
    return (
        _line(x0, y, mid - half_gap, y)
        + _line(mid - half_gap, y - plate, mid - half_gap, y + plate)
        + _line(mid + half_gap, y - plate, mid + half_gap, y + plate)
        + _line(mid + half_gap, y, x1, y)
    )


def _coax_section(
    x0: float, x1: float, y_hot: float, y_ret: float, label_lines: tuple[str, ...]
) -> str:
    """Coax section: the shield drawn as a cylinder around the centre conductor,
    with a pigtail from each end of the shield down to the return conductor.

    The centre conductor itself is the caller's hot rail passing through; the
    return conductor stops at the pigtails (inside the run, the shield is the
    return path).
    """
    r = COAX_RY
    # Shield drawn as a cylinder: parallel walls with the circular end faces
    # visible, the centre conductor entering through each end's centre.
    walls = _line(x0, y_hot - r, x1, y_hot - r) + _line(x0, y_hot + r, x1, y_hot + r)
    ends = "".join(f'<circle cx="{x:.1f}" cy="{y_hot:.1f}" r="{r}"/>' for x in (x0, x1))
    pigtails = _line(x0, y_hot + r, x0, y_ret) + _line(x1, y_hot + r, x1, y_ret)
    parts = [walls, ends, pigtails]
    y = y_hot - r - 12.0 - 13.0 * (len(label_lines) - 1)
    for s in label_lines:
        parts.append(_text((x0 + x1) / 2.0, y, s))
        y += 13.0
    return "".join(parts)


def _coax_body(x0: float, x1: float, y: float) -> str:
    """Shield cylinder walls and end faces around a conductor at y."""
    r = COAX_RY
    walls = _line(x0, y - r, x1, y - r) + _line(x0, y + r, x1, y + r)
    ends = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}"/>' for x in (x0, x1))
    return walls + ends


def _parallel_pair_section(
    x0: float, x1: float, y_hot: float, y_ret: float, label_lines: tuple[str, ...]
) -> str:
    """Two coax in parallel: centre conductors jumpered together at both ends,
    braids bonded at both ends, shields returning via pigtails."""
    r = COAX_RY
    y_up = y_hot - 26.0  # the second coax rides above the rail
    x_j0, x_j1 = x0 - 12.0, x1 + 12.0  # centre-conductor jumpers
    parts = [
        _coax_body(x0, x1, y_hot),
        _coax_body(x0, x1, y_up),
        # Upper centre conductor, jumpered onto the hot rail at both ends.
        _line(x_j0, y_up, x_j1, y_up),
        _line(x_j0, y_hot, x_j0, y_up),
        _line(x_j1, y_hot, x_j1, y_up),
        _dot(x_j0, y_hot),
        _dot(x_j1, y_hot),
        # Braids bonded at both ends; the shields return via the pigtails.
        _line(x0, y_up + r, x0, y_hot - r),
        _line(x1, y_up + r, x1, y_hot - r),
        _line(x0, y_hot + r, x0, y_ret),
        _line(x1, y_hot + r, x1, y_ret),
    ]
    y = y_up - r - 12.0 - 13.0 * (len(label_lines) - 1)
    for s in label_lines:
        parts.append(_text((x0 + x1) / 2.0, y, s))
        y += 13.0
    return "".join(parts)


def _unbalanced_section(
    x0: float,
    x1: float,
    y_hot: float,
    y_ret: float,
    label_lines: tuple[str, ...],
    coax: dict,
) -> str:
    """A coax run drawn per its construction: single cable, or a parallel
    pair for the catalog's "2x ... (parallel)" entries."""
    if "(parallel)" in coax["name"]:
        return _parallel_pair_section(x0, x1, y_hot, y_ret, label_lines)
    return _coax_section(x0, x1, y_hot, y_ret, label_lines)


def _balanced_pair_section(
    x0: float, x1: float, y_top: float, label_lines: tuple[str, ...]
) -> str:
    """Balanced pair: two coax side by side (one per conductor), a shield
    cylinder around each, braids bonded by a strap at both ends. The pair's
    shields float (no pigtails, no ground)."""
    r = COAX_RY
    parts = []
    for y in (y_top, y_top + RAIL_GAP):
        parts.append(_line(x0, y - r, x1, y - r) + _line(x0, y + r, x1, y + r))
        parts.append(
            "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}"/>' for x in (x0, x1))
        )
    # Braids soldered together at both ends.
    for x in (x0, x1):
        parts.append(_line(x, y_top + r, x, y_top + RAIL_GAP - r))
    y = y_top - r - 12.0 - 13.0 * (len(label_lines) - 1)
    for s in label_lines:
        parts.append(_text((x0 + x1) / 2.0, y, s))
        y += 13.0
    return "".join(parts)


def _balun_hairpin(x: float, y_top: float) -> tuple[str, float]:
    """Half-wave coax balun: a shielded hairpin (coax U) whose centre-conductor
    ends are the balanced pair. Returns (svg, x where the outer shield wall
    crosses the return-rail height, for the feed line's braid bond)."""
    r_c = RAIL_GAP / 2.0  # centre conductor
    r_o = r_c + COAX_RY  # shield, outer wall
    r_i = r_c - COAX_RY  # shield, inner wall
    y_bot = y_top + RAIL_GAP
    body = (
        f'<path d="M{x:.1f},{y_top:.1f} A{r_c},{r_c} 0 0 0 {x:.1f},{y_bot:.1f}"/>'
        f'<path d="M{x:.1f},{y_top - COAX_RY:.1f} '
        f'A{r_o},{r_o} 0 0 0 {x:.1f},{y_bot + COAX_RY:.1f}"/>'
        f'<path d="M{x:.1f},{y_top + COAX_RY:.1f} '
        f'A{r_i},{r_i} 0 0 0 {x:.1f},{y_bot - COAX_RY:.1f}"/>'
        + "".join(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{COAX_RY}"/>' for y in (y_top, y_bot)
        )
        + _dot(x, y_top)
        + _dot(x, y_bot)
    )
    bond_x = x - math.sqrt(r_o * r_o - r_c * r_c)
    return body, bond_x


def _hop(x: float, y_from: float, y_cross: float, y_to: float) -> str:
    """Vertical conductor that hops over a horizontal one at y_cross."""
    return (
        f'<path d="M{x:.1f},{y_from:.1f} V{y_cross - HOP_RADIUS:.1f} '
        f"A{HOP_RADIUS},{HOP_RADIUS} 0 0 1 {x:.1f},{y_cross + HOP_RADIUS:.1f} "
        f'V{y_to:.1f}"/>'
    )


def _loop_symbol(x_rails: float, y_top: float, cx: float, label: str) -> str:
    """Full-wave loop: a circle broken at the feed gap, fed from the pair."""
    cy = y_top + RAIL_GAP / 2.0
    gap = math.radians(LOOP_GAP_DEG)
    ax = cx - LOOP_RADIUS * math.cos(gap)
    dy = LOOP_RADIUS * math.sin(gap)
    return (
        _line(x_rails, y_top, ax, cy - dy)
        + _line(x_rails, y_top + RAIL_GAP, ax, cy + dy)
        + f'<path d="M{ax:.1f},{cy - dy:.1f} '
        f'A{LOOP_RADIUS},{LOOP_RADIUS} 0 1 1 {ax:.1f},{cy + dy:.1f}"/>'
        + _text(cx, cy + 4.0, label)
    )


def _crossover(x0: float, x1: float, y_top: float) -> str:
    """Conductor swap (crossed phasing-line connection), no junction."""
    y_bot = y_top + RAIL_GAP
    return _line(x0, y_top, x1, y_bot) + _line(x0, y_bot, x1, y_top)


def _series_element(series: dict | None, x0: float, x1: float, y: float) -> str:
    """Series match element in the hot conductor, or a plain wire."""
    if series is None:
        return _line(x0, y, x1, y)
    if series["kind"] == "capacitor":
        body = _capacitor(x0, x1, y)
        designator, value = "C1", f"{series['value_pf']:.1f} pF"
    else:
        body = _inductor(x0, x1, y)
        designator, value = "L1", f"{series['value_nh']:.0f} nH"
    mid = (x0 + x1) / 2.0
    return body + _text(mid, y - 37.0, designator) + _text(mid, y - 24.0, value)


def _line_phased(build: dict) -> tuple[str, int, int]:
    """Layout for the quarter-wave line feed; returns (body, width, height)."""
    match = build["match"]
    phasing = build["phasing_line"]
    crossed = phasing["connection"] == "crossed"

    y_a = 120.0  # hot rail of the main run and the loop A branch
    y_b = 230.0  # hot rail of the loop B branch
    x_term = 48.0
    # The series element sits between the transformer and the junction (it
    # cancels the feedpoint reactance before the line transforms the rest).
    x_tl0, x_tl1 = 90.0, 250.0
    x_ser0, x_ser1 = 280.0, 336.0
    x_tee_a, x_tee_b = 382.0, 398.0  # junction tees onto the two rails
    x_rail_end = 470.0  # loop A leads start here
    loop_a_cx = 530.0
    x_ph0, x_ph1 = 440.0, 600.0
    x_swap0, x_swap = 610.0, 634.0
    loop_b_cx = 696.0

    tl_coax = match["transformer_coax"]
    tl_label = (
        f"TL1  {tl_coax['name']} ({tl_coax['z0_ohm']:g} &#8486;)",
        f"1/4 wave  {match['transformer_length_mm']:.0f} mm",
    )
    ph_coax = phasing["coax"]
    ph_label = (
        f"TL2  {ph_coax['name']} ({ph_coax['z0_ohm']:g} &#8486;)",
        f"1/4 wave  {phasing['length_mm']:.0f} mm",
    )

    rig = f"to rig ({match['system_z_ohm']:g} &#8486;)"
    parts = [
        _text(x_term - 24.0, y_a + RAIL_GAP + 30.0, rig, "start"),
        _terminal_pair(x_term, y_a),
        # Hot rail (the centre conductor): terminal, through the transformer
        # shield, series element, on to the loop A leads.
        _line(x_term + TERMINAL_RADIUS, y_a, x_ser0, y_a),
        _series_element(match["series_element"], x_ser0, x_ser1, y_a),
        _line(x_ser1, y_a, x_rail_end, y_a),
        # Return conductor stops at the shield pigtails; inside the coax run
        # the shield is the return path.
        _line(x_term + TERMINAL_RADIUS, y_a + RAIL_GAP, x_tl0, y_a + RAIL_GAP),
        _line(x_tl1, y_a + RAIL_GAP, x_rail_end, y_a + RAIL_GAP),
        _unbalanced_section(x_tl0, x_tl1, y_a, y_a + RAIL_GAP, tl_label, tl_coax),
        # Junction: the phasing line tees off both conductors.
        _dot(x_tee_a, y_a),
        _dot(x_tee_b, y_a + RAIL_GAP),
        _hop(x_tee_a, y_a, y_a + RAIL_GAP, y_b),
        _line(x_tee_b, y_a + RAIL_GAP, x_tee_b, y_b + RAIL_GAP),
        _loop_symbol(x_rail_end, y_a, loop_a_cx, "LOOP A"),
        # Loop B branch pair, through the phasing line.
        _line(x_tee_a, y_b, x_swap0, y_b),
        _line(x_tee_b, y_b + RAIL_GAP, x_ph0, y_b + RAIL_GAP),
        _line(x_ph1, y_b + RAIL_GAP, x_swap0, y_b + RAIL_GAP),
        _unbalanced_section(x_ph0, x_ph1, y_b, y_b + RAIL_GAP, ph_label, ph_coax),
    ]
    if crossed:
        parts.append(_crossover(x_swap0, x_swap, y_b))
        parts.append(_text((x_swap0 + x_swap) / 2.0, y_b + RAIL_GAP + 24.0, "crossed"))
    else:
        parts.append(_line(x_swap0, y_b, x_swap, y_b))
        parts.append(_line(x_swap0, y_b + RAIL_GAP, x_swap, y_b + RAIL_GAP))
    parts.append(_loop_symbol(x_swap, y_b, loop_b_cx, "LOOP B"))
    return "".join(parts), 790, 320


def _section_label(designator: str, piece: dict, fraction: str) -> tuple[str, str]:
    coax = piece["coax"]
    return (
        f"{designator}  {coax['name']} ({coax['z0_ohm']:g} &#8486;)",
        f"{fraction} wave  {piece['length_mm']:.0f} mm",
    )


def _turnstile_layout(build: dict) -> tuple[str, int, int]:
    """Layout for the turnstile harness.

    Rig -> quarter-wave transformer -> harness port -> a Q-section leg per
    loop, with the delay line in loop B's leg and the sense connection at
    loop B.
    """
    harness = build["harness"]
    match = build["match"]
    crossed = harness["connection"] == "crossed"

    y_a = 120.0  # hot rail of the main run and the loop A leg
    y_b = 230.0  # hot rail of the loop B leg
    x_term = 48.0
    x_s0, x_s1 = 96.0, 244.0  # transformer
    x_ser0, x_ser1 = 268.0, 320.0  # series element, when fitted
    x_tee_a, x_tee_b = 348.0, 364.0  # harness port tees
    x_qa0, x_qa1 = 404.0, 524.0  # loop A Q-section
    x_rail_end = 560.0
    loop_a_cx = 620.0
    x_dl0, x_dl1 = 404.0, 500.0  # delay line, loop B leg
    x_qb0, x_qb1 = 528.0, 624.0  # loop B Q-section
    x_swap0, x_swap = 634.0, 658.0
    loop_b_cx = 720.0

    top_label = _section_label(
        "TL1",
        {
            "coax": match["transformer_coax"],
            "length_mm": match["transformer_length_mm"],
        },
        "1/4",
    )
    rig = f"to rig ({match['system_z_ohm']:g} &#8486;, 1:1 choke)"
    series = match["series_element"]

    parts = [
        _text(x_term - 24.0, y_a + RAIL_GAP + 30.0, rig, "start"),
        _terminal_pair(x_term, y_a),
        # Hot rail through the first section and series element to loop A.
        _line(x_term + TERMINAL_RADIUS, y_a, x_ser0, y_a),
        _series_element(series, x_ser0, x_ser1, y_a),
        _line(x_ser1, y_a, x_rail_end, y_a),
        # Return rail, broken for each coax section's shield.
        _line(x_term + TERMINAL_RADIUS, y_a + RAIL_GAP, x_s0, y_a + RAIL_GAP),
        _line(x_s1, y_a + RAIL_GAP, x_rail_end, y_a + RAIL_GAP),
        _unbalanced_section(
            x_s0, x_s1, y_a, y_a + RAIL_GAP, top_label, match["transformer_coax"]
        ),
        _coax_section(
            x_qa0,
            x_qa1,
            y_a,
            y_a + RAIL_GAP,
            _section_label("Q1", harness["q_section"], "1/4"),
        ),
        # Harness port: loop B's leg tees off both conductors.
        _dot(x_tee_a, y_a),
        _dot(x_tee_b, y_a + RAIL_GAP),
        _hop(x_tee_a, y_a, y_a + RAIL_GAP, y_b),
        _line(x_tee_b, y_a + RAIL_GAP, x_tee_b, y_b + RAIL_GAP),
        _loop_symbol(x_rail_end, y_a, loop_a_cx, "LOOP A"),
        # Loop B leg: delay line then Q-section.
        _line(x_tee_a, y_b, x_swap0, y_b),
        _line(x_tee_b, y_b + RAIL_GAP, x_dl0, y_b + RAIL_GAP),
        _line(x_dl1, y_b + RAIL_GAP, x_qb0, y_b + RAIL_GAP),
        _line(x_qb1, y_b + RAIL_GAP, x_swap0, y_b + RAIL_GAP),
        _coax_section(
            x_dl0,
            x_dl1,
            y_b,
            y_b + RAIL_GAP,
            _section_label("DL1", harness["delay_line"], "1/4"),
        ),
        _coax_section(
            x_qb0,
            x_qb1,
            y_b,
            y_b + RAIL_GAP,
            _section_label("Q2", harness["q_section"], "1/4"),
        ),
    ]
    if crossed:
        parts.append(_crossover(x_swap0, x_swap, y_b))
        parts.append(_text((x_swap0 + x_swap) / 2.0, y_b + RAIL_GAP + 24.0, "crossed"))
    else:
        parts.append(_line(x_swap0, y_b, x_swap, y_b))
        parts.append(_line(x_swap0, y_b + RAIL_GAP, x_swap, y_b + RAIL_GAP))
    parts.append(_loop_symbol(x_swap, y_b, loop_b_cx, "LOOP B"))
    return "".join(parts), 810, 320


def _balun4_layout(build: dict) -> tuple[str, int, int]:
    """Layout for the F5VIF balanced system (balun4).

    Rig coax arrives at one end of the half-wave balun hairpin (the feedline
    braid bonds to the hairpin's shield; nothing in the harness is grounded);
    the hairpin's open ends are the 200 ohm balanced pair, which
    runs through the balanced Q-section to the junction across loop A; the
    balanced phasing line reaches loop B.
    """
    harness = build["harness"]
    match = build["match"]
    balun = harness["balun"]
    crossed = harness["connection"] == "crossed"

    y_a = 120.0  # upper conductor of the balanced pair and the loop A run
    y_b = 230.0  # upper conductor of the loop B branch
    x_term = 40.0
    x_balun = 124.0  # hairpin open ends (the balanced pair starts here)
    x_q0, x_q1 = 180.0, 320.0  # balanced Q-section
    x_tee_a, x_tee_b = 382.0, 398.0  # junction tees
    x_rail_end = 470.0
    loop_a_cx = 530.0
    x_ph0, x_ph1 = 440.0, 600.0  # balanced phasing line
    x_swap0, x_swap = 610.0, 634.0
    loop_b_cx = 696.0

    rig = f"to rig ({match['system_z_ohm']:g} &#8486;)"
    y_bot = y_a + RAIL_GAP
    balun_label_1 = f"BL1  {balun['coax']['name']} 4:1 balun"
    balun_label_2 = f"1/2 wave  {balun['length_mm']:.0f} mm"
    hairpin, bond_x = _balun_hairpin(x_balun, y_a)
    parts = [
        _terminal_pair(x_term, y_a),
        # Feedline: centre conductor to the hairpin's near end, braid bonded
        # onto the hairpin's shield (there is no ground in this harness).
        _line(x_term + TERMINAL_RADIUS, y_a, x_balun, y_a),
        _line(x_term + TERMINAL_RADIUS, y_bot, bond_x, y_bot),
        _dot(bond_x, y_bot),
        hairpin,
        _text(x_term - 20.0, y_bot + 42.0, balun_label_1, "start"),
        _text(x_term - 20.0, y_bot + 55.0, balun_label_2, "start"),
        _text(x_term - 20.0, y_bot + 78.0, rig, "start"),
        # The balanced pair to the loop A junction.
        _line(x_balun, y_a, x_rail_end, y_a),
        _line(x_balun, y_a + RAIL_GAP, x_rail_end, y_a + RAIL_GAP),
        _balanced_pair_section(
            x_q0, x_q1, y_a, _section_label("Q1", harness["q_section"], "1/4")
        ),
        _dot(x_tee_a, y_a),
        _dot(x_tee_b, y_a + RAIL_GAP),
        _hop(x_tee_a, y_a, y_a + RAIL_GAP, y_b),
        _line(x_tee_b, y_a + RAIL_GAP, x_tee_b, y_b + RAIL_GAP),
        _loop_symbol(x_rail_end, y_a, loop_a_cx, "LOOP A"),
        # Balanced phasing line to loop B.
        _line(x_tee_a, y_b, x_swap0, y_b),
        _line(x_tee_b, y_b + RAIL_GAP, x_swap0, y_b + RAIL_GAP),
        _balanced_pair_section(
            x_ph0, x_ph1, y_b, _section_label("PL1", harness["phasing_line"], "1/4")
        ),
    ]
    if crossed:
        parts.append(_crossover(x_swap0, x_swap, y_b))
        parts.append(_text((x_swap0 + x_swap) / 2.0, y_b + RAIL_GAP + 24.0, "crossed"))
    else:
        parts.append(_line(x_swap0, y_b, x_swap, y_b))
        parts.append(_line(x_swap0, y_b + RAIL_GAP, x_swap, y_b + RAIL_GAP))
    parts.append(_loop_symbol(x_swap, y_b, loop_b_cx, "LOOP B"))
    return "".join(parts), 780, 330


def render_feed_schematic(result: DesignResult) -> str:
    """Feed and match schematic for a tuned design, as an SVG string."""
    build = result_to_dict(result)["build"]
    if "phasing_line" in build:
        body, width, height = _line_phased(build)
    elif "phasing_line" in build["harness"]:
        body, width, height = _balun4_layout(build)
    else:
        body, width, height = _turnstile_layout(build)
    return (
        f'<svg class="sch" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="Feed and match schematic">{body}</svg>'
    )
