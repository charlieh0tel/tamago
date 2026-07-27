"""Coax cable catalog.

Every section built from coax (the phasing line, the matching transformer) is
described by a Coax: a characteristic impedance paired with the velocity
factor that sets the physical cut length.  The catalog lists the common cables
the tool suggests; a custom cable is just a Coax built with its own numbers.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Coax:
    """One coax cable type.

    Fields:
        name: cable designation (e.g. "RG-62"), or any label for a custom cable.
        z0_ohm: characteristic impedance.
        vf: velocity factor (physical length over free-space electrical length).
    """

    name: str
    z0_ohm: float
    vf: float


RG_58 = Coax("RG-58", 50.0, 0.66)
RG_59 = Coax("RG-59", 75.0, 0.66)
RG_62 = Coax("RG-62", 93.0, 0.84)
# Two equal lengths connected in parallel halve the impedance: the standard
# construction for low transformer impedances.
RG_58_PAIR = Coax("2x RG-58 (parallel)", 25.0, 0.66)
RG_59_PAIR = Coax("2x RG-59 (parallel)", 37.5, 0.66)
# Two lengths side by side with braids bonded, the center conductors used as
# a shielded balanced pair: differential impedance is the sum. Not in the
# catalog (it is a balanced line, not a transformer suggestion).
RG_58_BALANCED = Coax("2x RG-58 (balanced)", 100.0, 0.66)

# Cables suggested for the matching transformer and the default phasing line.
COAX_CATALOG = (RG_58_PAIR, RG_59_PAIR, RG_58, RG_59, RG_62)


def nearest_standard_coax(z0: float) -> Coax:
    """Catalog cable whose characteristic impedance is closest to z0."""
    return min(COAX_CATALOG, key=lambda c: abs(c.z0_ohm - z0))


def catalog_coax(name: str) -> Coax:
    """Look up a catalog cable by name."""
    for coax in COAX_CATALOG:
        if coax.name == name:
            return coax
    known = ", ".join(c.name for c in COAX_CATALOG)
    raise ValueError(f"unknown coax {name!r} (catalog: {known})")
