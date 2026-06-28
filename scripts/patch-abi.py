#!/usr/bin/env python3
"""Restore the legacy ABI spellings after CDT >= 4.1 -abigen.

Background
----------
The AtomicMarket contract deployed on WAX mainnet (like the AtomicAssets contract
it builds on) was compiled with an older CDT. Modern CDT (4.1.x) changed two
-abigen spellings in wire-compatible but tool-visible ways. ABI field/type *names*
are how external tools (atomicmarket-js, wallets, the ECA indexer, cleos JSON)
pack/unpack data, so each change breaks existing integrations even though the
compiled wasm and the binary wire format are identical. This script restores the
deployed spellings; the wasm is untouched.

Two regressions are reverted:

1. std::pair fields  `first`/`second`  ->  `key`/`value`
   (the `ATTRIBUTE_MAP` element type `pair_string_ATOMIC_ATTRIBUTE`, pulled in via
   atomicdata.hpp). Old CDT named pair fields key/value; CDT 4.1 hardcodes the C++
   member names.

2. std::vector<uint8_t>  `bytes`  ->  `uint8[]`
   Old CDT spelled vector<uint8_t> as `uint8[]` and vector<int8_t> as `bytes`;
   CDT 4.1 collapses BOTH to `bytes`. The legacy ABIs keep `bytes` only for the
   `INT8_VEC` alias (vector<int8_t>), so we convert every `bytes` EXCEPT that one.

(The spelling rules were originally verified byte-for-byte against the deployed
atomicassets ABI via https://wax.greymass.com get_abi; the same legacy-CDT
spellings apply to the deployed atomicmarket ABI, which shares these types
through atomicdata / the atomicassets interface.)

Idempotent: patching an already-patched ABI is a no-op (asserted after every run).

Usage:
  patch-abi.py [path/to/contract.abi]          patch the ABI in place (default
                                               build/atomicmarket.abi)
  patch-abi.py --verify-against RAW PATCHED    do not write anything; assert that
                                               PATCHED differs from the raw CDT ABI
                                               RAW only by the two sanctioned
                                               transformations (exit non-zero
                                               otherwise). Used by CI to prove the
                                               released ABI was not mis-spelled.
"""
import copy
import json
import sys

PAIR_FIELDS = {"first": "key", "second": "value"}
# vector<int8_t> legitimately stays `bytes` on the deployed ABI; everything else
# spelled `bytes` by CDT 4.1 is vector<uint8_t> and must become `uint8[]`.
KEEP_BYTES_TYPES = {"INT8_VEC"}


def patch_abi(abi: dict) -> tuple:
    """Apply the two spelling transformations in place. Returns (pair_renames,
    bytes_fixes)."""
    pair_renames = 0
    bytes_fixes = 0

    # 1. pair field names first/second -> key/value (scoped to pair_* structs).
    for struct in abi.get("structs", []):
        if not struct["name"].startswith("pair_"):
            continue
        for field in struct.get("fields", []):
            new = PAIR_FIELDS.get(field["name"])
            if new:
                field["name"] = new
                pair_renames += 1

    # 2. bytes -> uint8[] for vector<uint8_t> (type aliases + struct fields),
    #    preserving `bytes` only for the int8 vector alias.
    for typedef in abi.get("types", []):
        if typedef["new_type_name"] in KEEP_BYTES_TYPES:
            continue
        if typedef["type"] == "bytes":
            typedef["type"] = "uint8[]"
            bytes_fixes += 1
    for struct in abi.get("structs", []):
        for field in struct.get("fields", []):
            if field["type"] == "bytes":
                field["type"] = "uint8[]"
                bytes_fixes += 1

    # Fail closed: no stray pair field names may remain on a pair_* struct (the
    # rename above must have covered them all). Non-pair structs are NOT checked —
    # a struct could legitimately have a field literally named `first`/`second`,
    # and we never touch those.
    leftover = [
        struct["name"]
        for struct in abi.get("structs", [])
        if struct["name"].startswith("pair_")
        for field in struct.get("fields", [])
        if field["name"] in PAIR_FIELDS
    ]
    if leftover:
        sys.exit(f"patch-abi: refusing — first/second remain on pair_* structs: {sorted(set(leftover))}")

    return pair_renames, bytes_fixes


def assert_idempotent(abi: dict) -> None:
    """Patching an already-patched ABI must produce no further change."""
    again = copy.deepcopy(abi)
    pair_renames, bytes_fixes = patch_abi(again)
    if pair_renames or bytes_fixes or again != abi:
        sys.exit("patch-abi: NOT idempotent — re-running the patcher changed the ABI")


def verify_against(raw_path: str, patched_path: str) -> None:
    """Assert the patched ABI differs from the raw CDT ABI by ONLY the two
    sanctioned transformations (pair first/second -> key/value on pair_* structs;
    bytes -> uint8[] on non-INT8_VEC types/fields), with the same interface
    (actions/tables and their types, and the same set of type/struct names).

    Catches a patcher (or future contract change) that rewrites anything outside
    that envelope — a non-`bytes` type/field becoming `uint8[]`, a renamed or
    retyped action/table, an added/removed struct, a changed struct `base`, etc.

    Limitation: it canNOT distinguish a vector<int8_t> from a vector<uint8_t>,
    because CDT 4.1 emits both as `bytes` and the ABI carries no signedness. Any
    `bytes` -> `uint8[]` change is therefore accepted as sanctioned. A genuinely
    new inline vector<int8_t> field would still be (wrongly) converted and pass
    here — preserving signed vectors relies on the INT8_VEC typedef being used."""
    with open(raw_path) as fh:
        raw = json.load(fh)
    with open(patched_path) as fh:
        patched = json.load(fh)

    errors = []

    # The patched ABI must describe the same interface: same set of type/struct
    # names, and — for actions and tables — the same name->type mapping (a changed
    # action/table type is a breaking interface change the spelling pass must not
    # introduce). Only spellings may differ.
    def names(items, key):
        return sorted(item[key] for item in items)

    for section, key in (("types", "new_type_name"), ("structs", "name")):
        if names(raw.get(section, []), key) != names(patched.get(section, []), key):
            errors.append(f"{section} set changed between raw and patched ABI")

    for section in ("actions", "tables"):
        raw_map = {item["name"]: item["type"] for item in raw.get(section, [])}
        patched_map = {item["name"]: item["type"] for item in patched.get(section, [])}
        if raw_map != patched_map:
            errors.append(f"{section} name->type mapping changed between raw and patched ABI")

    raw_types = {t["new_type_name"]: t["type"] for t in raw.get("types", [])}
    patched_types = {t["new_type_name"]: t["type"] for t in patched.get("types", [])}
    for name, raw_type in raw_types.items():
        patched_type = patched_types.get(name)
        if patched_type == raw_type:
            continue
        if raw_type == "bytes" and patched_type == "uint8[]" and name not in KEEP_BYTES_TYPES:
            continue
        errors.append(f"type {name}: unsanctioned change {raw_type!r} -> {patched_type!r}")
    for name in KEEP_BYTES_TYPES:
        if name in patched_types and patched_types[name] != "bytes":
            errors.append(f"type {name}: must stay `bytes` (vector<int8_t>), got {patched_types[name]!r}")

    raw_structs = {s["name"]: s for s in raw.get("structs", [])}
    patched_structs = {s["name"]: s for s in patched.get("structs", [])}
    for name, raw_struct in raw_structs.items():
        patched_struct = patched_structs.get(name)
        if patched_struct is None:
            continue  # already reported by the set check above
        if raw_struct.get("base", "") != patched_struct.get("base", ""):
            errors.append(f"struct {name}: base changed {raw_struct.get('base')!r} -> {patched_struct.get('base')!r}")
        raw_fields = raw_struct.get("fields", [])
        patched_fields = patched_struct.get("fields", [])
        if len(raw_fields) != len(patched_fields):
            errors.append(f"struct {name}: field count changed")
            continue
        is_pair = name.startswith("pair_")
        for raw_field, patched_field in zip(raw_fields, patched_fields):
            # field name: unchanged, or first/second -> key/value on a pair_* struct
            if raw_field["name"] != patched_field["name"]:
                if not (is_pair and PAIR_FIELDS.get(raw_field["name"]) == patched_field["name"]):
                    errors.append(f"struct {name}: field name {raw_field['name']!r} -> {patched_field['name']!r}")
            # field type: unchanged, or bytes -> uint8[]
            if raw_field["type"] != patched_field["type"]:
                if not (raw_field["type"] == "bytes" and patched_field["type"] == "uint8[]"):
                    errors.append(
                        f"struct {name}.{raw_field['name']}: unsanctioned change "
                        f"{raw_field['type']!r} -> {patched_field['type']!r}"
                    )

    if errors:
        sys.exit("patch-abi --verify-against found unsanctioned ABI changes:\n  " + "\n  ".join(errors))

    print(f"patch-abi: verified {patched_path} differs from {raw_path} only by sanctioned spellings")


def main(path: str) -> None:
    with open(path) as fh:
        abi = json.load(fh)

    pair_renames, bytes_fixes = patch_abi(abi)
    assert_idempotent(abi)

    with open(path, "w") as fh:
        json.dump(abi, fh, indent=4)
        fh.write("\n")

    print(f"patch-abi: {path}: pair fields={pair_renames}, bytes->uint8[]={bytes_fixes}")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--verify-against":
        if len(sys.argv) != 4:
            sys.exit("usage: patch-abi.py --verify-against RAW_ABI PATCHED_ABI")
        verify_against(sys.argv[2], sys.argv[3])
    else:
        main(sys.argv[1] if len(sys.argv) > 1 else "build/atomicmarket.abi")
