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
  const stderr = [];
  // With EXIT_RUNTIME=1, callMain returns the exit status directly and also
  // reports it through onExit. Module.quit is NOT an override point in current
  // Emscripten -- supplying one silently does nothing, which is how a failing
  // run used to be mistaken for a successful one.
  let exitCode = 0;
  const module = await createNec2c({
    noInitialRun: true,
    onExit: (code) => {
      exitCode = code;
    },
    print: () => {},
    printErr: (line) => stderr.push(line),
  });

  module.FS.writeFile(INPUT_PATH, deckText);
  const returned = module.callMain(["-i", INPUT_PATH, "-o", OUTPUT_PATH]);
  if (typeof returned === "number") exitCode = returned;

  // nec2c reports input problems by writing a message into its output file
  // rather than to stderr, so read the file even on failure. It is absent if
  // nec2c aborted before opening it.
  let output = "";
  try {
    output = module.FS.readFile(OUTPUT_PATH, { encoding: "utf8" });
  } catch {
    output = "";
  }

  if (exitCode !== 0) {
    const detail =
      stderr.join("\n").trim() ||
      output
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /ERROR|ABORT|CANNOT|FAULT/i.test(l))
        .pop() ||
      "";
    throw new Error(
      `nec2c exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }

  return output;
}
