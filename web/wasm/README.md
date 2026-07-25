# nec2c WebAssembly build

This directory builds [nec2c](https://www.qsl.net/5b4az/) (Neoklis Kyriazis
5B4AZ's C translation of NEC-2) into a WebAssembly ES module that runs in both
Node (>= 20) and browsers. The tuner and optimizer call it many times per
session, so the wrapper is built to survive long sequences of runs.

## Layout

- `third_party/nec2c/` (repo top level) - vendored, unmodified nec2c C source.
- `web/wasm/build.sh` - emcc build script; emits the prebuilt artifacts.
- `web/wasm/runner.mjs` - `runNec(deckText)` wrapper around the module.
- `web/wasm/smoke.mjs` - rerunnable validation + timing harness.
- `prebuilts/nec2c/nec2c.mjs` + `nec2c.wasm` - committed prebuilt artifacts
  (project policy: built WebAssembly is checked in).

## Provenance

- Source: nec2c 1.3.1, upstream author Neoklis Kyriazis (5B4AZ),
  <https://www.qsl.net/5b4az/>.
- Obtained from the Debian/Ubuntu source package `nec2c` 1.3.1-3
  (the same version as the system `nec2c` binary used for validation):
  - `nec2c_1.3.1.orig.tar.bz2`, md5 `0d86f0ae43679b9e4a3a4e3877ab62f2`
    (from `http://archive.ubuntu.com/ubuntu/pool/universe/n/nec2c/`).
  - Vendored files are the **pristine upstream 1.3.1 sources** from that
    tarball (`*.c`, `nec2c.h`, `shared.h`, plus `Makefile.am`, `configure.ac`,
    `config.h.in`, `COPYING`, `README`, `AUTHORS`, `ChangeLog`, `NEWS`,
    `NEC2-bug.txt`).
  - The Debian packaging adds exactly one patch,
    `gnome-common-migration.patch`, which rewrites `autogen.sh` only (build
    bootstrap) and changes **no compiled code**. It is vendored for provenance
    but is not applied by this build.
- The `github.com/KJ7LNW/nec2c` mirror was evaluated but is a downstream fork
  with extra history and a monolithic `nec2c.c`; the pristine 1.3.1 split
  sources were used instead to match the validated system binary.

## License

Both nec2c and this project are GPL. nec2c 1.3.1 is licensed **GPLv3** (see
`third_party/nec2c/COPYING`). The vendored source, the build script, and the
committed `.mjs`/`.wasm` artifacts are all covered by the GPLv3 obligations:
the corresponding source is vendored in-tree at `third_party/nec2c/`, and the
build is fully reproducible via `build.sh`. Keep the `COPYING` file and this
provenance intact when redistributing the artifacts.

## Build

Requires the Emscripten SDK (`emcc`). Setup:

```sh
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
source ~/emsdk/emsdk_env.sh   # puts emcc on PATH
```

Then, from anywhere in the repo:

```sh
bash web/wasm/build.sh
```

`build.sh` sources `~/emsdk/emsdk_env.sh` automatically if `emcc` is not
already on `PATH` (override with `EMSDK_ENV=/path/to/emsdk_env.sh`).

The exact compile command it runs (emcc 6.0.3, Emscripten):

```sh
emcc -O2 \
  -DPACKAGE_STRING='"nec2c 1.3.1"' \
  -I third_party/nec2c \
  third_party/nec2c/{calculations,geometry,input,matrix,network,shared,\
fields,ground,main,misc,radiation,somnec}.c \
  -o prebuilts/nec2c/nec2c.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNec2c \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,node
```

Notes:
- The source list mirrors `nec2c_SOURCES` in `Makefile.am`.
- `PACKAGE_STRING` is the only autoconf/`config.h` symbol the code references
  (printed by `nec2c -v`), so it is supplied on the command line instead of
  running `./configure` to generate `config.h`.

## Wrapper API

```js
import { runNec } from "./web/wasm/runner.mjs";

const outputText = await runNec(deckText);
```

`runNec(deckText)` writes the NEC deck to MEMFS as `in.nec`, invokes
`callMain(["-i","in.nec","-o","out.txt"])`, and returns the full text of
`out.txt`. It throws if nec2c exits non-zero.

### Per-call model

The module is built with `EXIT_RUNTIME=1`, so the runtime is torn down when
`main()` returns and an instance cannot be reused. nec2c also carries heavy
file-scope global state. Both point to the same design: **a fresh module
instance per call**. The `MODULARIZE` factory is imported once and re-invoked
per call; each instance gets its own memory and MEMFS, which is what makes long
sequential run sequences safe. Measured repeatability: 20 sequential calls
produce byte-identical output (see below). Instance reuse was not pursued
because these build flags preclude it and offer no correctness benefit.

## Validation and measured numbers

Run:

```sh
node web/wasm/smoke.mjs            # defaults to satellite_pair_circle.2m.nec
node web/wasm/smoke.mjs some.nec   # or any deck
```

The harness runs the deck through the native `/usr/bin/nec2c` and the wasm
runner, then compares the ANTENNA INPUT PARAMETERS impedance row and a sample
of RADIATION PATTERNS rows (tolerance 1e-4 relative), runs 20 sequential wasm
calls for repeatability, and reports timing.

Latest results (deck `designs/satellite_pair_circle.2m.nec`, Node v20.18.1):

- ANTENNA INPUT PARAMETERS impedance: native `45.822 - 7.9812e-5j`,
  wasm identical; max relative difference across the row `0`.
- RADIATION PATTERNS sampled rows (theta/phi 0/0, 30/0, 60/0, 0/15, 30/15):
  max relative difference `0`.
- Overall worst relative difference `0` (output is byte-identical to native,
  well within the 1e-4 tolerance).
- Repeatability: 20 sequential wasm calls produce identical output. PASS.
- Timing: wasm ~22 ms/run (fresh instance per call) vs native ~14 ms/run,
  averaged over 20 runs.

## Artifact sizes

- `prebuilts/nec2c/nec2c.mjs`: ~60 KB
- `prebuilts/nec2c/nec2c.wasm`: ~253 KB

## Rebuilding after a source or toolchain change

1. Ensure emsdk is installed and activated (see Build).
2. `bash web/wasm/build.sh`
3. `node web/wasm/smoke.mjs` and confirm PASS.
4. Commit the updated `prebuilts/nec2c/*` artifacts.
