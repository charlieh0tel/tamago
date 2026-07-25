#!/usr/bin/env bash
#
# Build nec2c as a WebAssembly ES module.
#
# Compiles the vendored nec2c 1.3.1 C sources (third_party/nec2c) with emcc
# and emits the committed prebuilt artifacts:
#   prebuilts/nec2c/nec2c.mjs
#   prebuilts/nec2c/nec2c.wasm
#
# Requires the Emscripten SDK. If EMSDK is not already in the environment we
# source it from ~/emsdk (see web/wasm/README.md for emsdk setup).

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
vendor="$repo_root/third_party/nec2c"
outdir="$repo_root/prebuilts/nec2c"

# Bring emcc into PATH if the caller has not already done so.
if ! command -v emcc >/dev/null 2>&1; then
  emsdk_env="${EMSDK_ENV:-$HOME/emsdk/emsdk_env.sh}"
  if [ -f "$emsdk_env" ]; then
    # shellcheck disable=SC1090
    source "$emsdk_env" >/dev/null 2>&1
  fi
fi
command -v emcc >/dev/null 2>&1 || {
  echo "error: emcc not found; install emsdk (see web/wasm/README.md)" >&2
  exit 1
}

mkdir -p "$outdir"

# nec2c source files (from Makefile.am nec2c_SOURCES, headers excluded).
sources=(
  calculations.c
  geometry.c
  input.c
  matrix.c
  network.c
  shared.c
  fields.c
  ground.c
  main.c
  misc.c
  radiation.c
  somnec.c
)

srcpaths=()
for s in "${sources[@]}"; do
  srcpaths+=("$vendor/$s")
done

# PACKAGE_STRING is the only autoconf/config.h macro referenced by the code
# (main.c, printed by -v). We supply it directly rather than generating
# config.h so the build needs no ./configure step.
emcc -O2 \
  -DPACKAGE_STRING='"nec2c 1.3.1"' \
  -I"$vendor" \
  "${srcpaths[@]}" \
  -o "$outdir/nec2c.mjs" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createNec2c \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,node

echo "built:"
ls -l "$outdir/nec2c.mjs" "$outdir/nec2c.wasm"
