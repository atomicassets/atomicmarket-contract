# Native-CDT build of the AtomicMarket contract (CI installs the pinned CDT 4.1.1
# natively). For local builds without a native CDT install, use `bash build.sh`
# instead - it runs the same pinned compiler inside the antelope-cdt docker image
# and produces identical artifacts.
build:
	mkdir -p build
	cdt-cpp -abigen -contract=atomicmarket -I./include -R./resource src/atomicmarket.cpp -o build/atomicmarket.wasm

# Release-only ABI normalization. CDT 4.1 changed two -abigen spellings
# (pair fields first/second; vector<uint8_t> as `bytes`) that break existing
# integrations. The VeRT test suite is written against the raw CDT 4.1 abi, so we
# patch ONLY for distribution/on-chain deploy — never for the test build. The wasm
# is identical either way (abi labels don't affect the binary wire format).
patch-abi:
	python3 scripts/patch-abi.py build/atomicmarket.abi

# Build the distributable artifacts (wasm + legacy-compatible abi) for release /
# `cleos set contract`. Do NOT use for running tests — use `make build`.
# Sequence build -> patch-abi via sub-makes so `make -j release` cannot start
# patch-abi before build has produced build/atomicmarket.abi.
release:
	$(MAKE) build
	$(MAKE) patch-abi

export-memory:
	wasm2wat build/atomicmarket.wasm | sed -e 's|(memory |(memory (export "memory") |' > atomicmarket.wat
	wat2wasm -o build/atomicmarket.wasm atomicmarket.wat
	rm atomicmarket.wat

.PHONY: build patch-abi release export-memory clean
clean:
	-rm -rf build
