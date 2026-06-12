#!/usr/bin/env bash
# Builds the atomicmarket contract with the pinned CDT 4.1.1 via the antelope-cdt docker
# image (CI installs the same version natively). Usage: bash build.sh
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DIR/build"

docker run --rm -v "$DIR":/work -w /work antelope-cdt \
    cdt-cpp -abigen -contract=atomicmarket -I./include -R./resource src/atomicmarket.cpp -o build/atomicmarket.wasm
