// Number formatting helpers shared across the engine.
//
// NEC decks and cut sheets must eventually match the Python output, which uses
// printf-style formats. toFixed(n) reproduces Python's "%.<n>f" for the value
// ranges the deck emits. formatG reproduces Python's "%g" (used in the human
// stock descriptions): six significant digits, trailing zeros stripped.

// Python "%g" default precision.
const DEFAULT_G_PRECISION = 6;

export function formatG(x: number, precision: number = DEFAULT_G_PRECISION): string {
  if (Number.isNaN(x)) {
    return "nan";
  }
  if (!Number.isFinite(x)) {
    return x > 0 ? "inf" : "-inf";
  }
  if (x === 0) {
    return "0";
  }
  const exponent = Math.floor(Math.log10(Math.abs(x)));
  // Python %g switches to exponential when exp < -4 or exp >= precision.
  if (exponent < -4 || exponent >= precision) {
    let text = x.toExponential(precision - 1);
    text = text.replace(/\.?0+e/, "e");
    // Python pads the exponent to at least two digits.
    text = text.replace(/e([+-])(\d)$/, "e$10$2");
    return text;
  }
  let text = x.toFixed(Math.max(0, precision - 1 - exponent));
  if (text.indexOf(".") >= 0) {
    text = text.replace(/\.?0+$/, "");
  }
  return text;
}
