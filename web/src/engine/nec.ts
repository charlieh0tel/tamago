// NEC-2 deck emission and nec2c output parsing.
//
// This lived here until it was general enough to stand alone, and now ships as
// the nec2c-deck package. Kept as a re-export so the engine's imports stay
// pointed at ./nec rather than naming the package in a dozen modules.

export * from "nec2c-deck";
