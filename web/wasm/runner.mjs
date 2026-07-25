// Wrapper around the nec2c WebAssembly module.
//
// nec2c is a file-in/file-out CLI. We run it against an in-memory (MEMFS)
// filesystem: write the input deck, invoke main() with -i/-o, read the output.
//
// The module is built with EXIT_RUNTIME=1, so the runtime is torn down when
// main() returns and an instance cannot be reused. nec2c also keeps extensive
// file-scope global state. Both facts point to the same design: instantiate a
// fresh module for every call. The factory (from MODULARIZE) is imported once
// and is cheap to re-invoke; only the per-call instance holds run state.

import createNec2c from "../../prebuilts/nec2c/nec2c.mjs";

const INPUT_PATH = "in.nec";
const OUTPUT_PATH = "out.txt";

// Run one nec2c job. `deckText` is the NEC input deck; resolves to the full
// text of nec2c's output file. Throws if nec2c exits non-zero.
export async function runNec(deckText) {
  let exitCode = 0;
  const module = await createNec2c({
    noInitialRun: true,
    // EXIT_RUNTIME=1 routes a normal main() return through exit(); capture the
    // code instead of letting Emscripten treat a nonzero exit as a throw.
    quit: (code) => {
      exitCode = code;
    },
    print: () => {},
    printErr: () => {},
  });

  module.FS.writeFile(INPUT_PATH, deckText);
  module.callMain(["-i", INPUT_PATH, "-o", OUTPUT_PATH]);

  if (exitCode !== 0) {
    throw new Error(`nec2c exited with code ${exitCode}`);
  }

  return module.FS.readFile(OUTPUT_PATH, { encoding: "utf8" });
}
