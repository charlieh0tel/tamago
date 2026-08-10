// Coax cable catalog. Ported from the retired Python coax.py.
//
// Every section built from coax (the phasing line, the matching transformer) is
// described by a Coax: a characteristic impedance paired with the velocity
// factor that sets the physical cut length. The catalog lists the common cables
// the tool suggests; a custom cable is just a Coax built with its own numbers.

// One coax cable type.
//   name: cable designation (e.g. "RG-62"), or any label for a custom cable.
//   z0Ohm: characteristic impedance.
//   vf: velocity factor (physical length over free-space electrical length).
export interface Coax {
  name: string;
  z0Ohm: number;
  vf: number;
}

export const RG_58: Coax = { name: "RG-58", z0Ohm: 50.0, vf: 0.66 };
export const RG_59: Coax = { name: "RG-59", z0Ohm: 75.0, vf: 0.66 };
export const RG_62: Coax = { name: "RG-62", z0Ohm: 93.0, vf: 0.84 };
// Two equal lengths connected in parallel halve the impedance: the standard
// construction for low transformer impedances.
export const RG_58_PAIR: Coax = { name: "2x RG-58 (parallel)", z0Ohm: 25.0, vf: 0.66 };
export const RG_59_PAIR: Coax = { name: "2x RG-59 (parallel)", z0Ohm: 37.5, vf: 0.66 };
// Two lengths side by side with braids bonded, the center conductors used as a
// shielded balanced pair: differential impedance is the sum. Not in the catalog
// (it is a balanced line, not a transformer suggestion).
export const RG_58_BALANCED: Coax = {
  name: "2x RG-58 (balanced)",
  z0Ohm: 100.0,
  vf: 0.66,
};

// Cables suggested for the matching transformer and the default phasing line.
export const COAX_CATALOG: readonly Coax[] = [
  RG_58_PAIR,
  RG_59_PAIR,
  RG_58,
  RG_59,
  RG_62,
];

// Catalog cable whose characteristic impedance is closest to z0.
export function nearestStandardCoax(z0: number): Coax {
  let best = COAX_CATALOG[0];
  if (best === undefined) {
    throw new Error("empty coax catalog");
  }
  let bestDelta = Math.abs(best.z0Ohm - z0);
  for (const coax of COAX_CATALOG) {
    const delta = Math.abs(coax.z0Ohm - z0);
    if (delta < bestDelta) {
      best = coax;
      bestDelta = delta;
    }
  }
  return best;
}

// Look up a catalog cable by name.
export function catalogCoax(name: string): Coax {
  for (const coax of COAX_CATALOG) {
    if (coax.name === name) {
      return coax;
    }
  }
  const known = COAX_CATALOG.map((c) => c.name).join(", ");
  throw new Error(`unknown coax ${JSON.stringify(name)} (catalog: ${known})`);
}
