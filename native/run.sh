#!/usr/bin/env bash
set -euo pipefail
ct_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ct_build_dir="$(mktemp -d "${TMPDIR:-/tmp}/concurrency-theatre-native.XXXXXX")"
trap 'rm -rf -- "$ct_build_dir"' EXIT
"${CXX:-g++}" -std=c++17 -O2 -fopenmp '-DCT_BUILD_FLAGS="-std=c++17 -O2 -fopenmp"' "$ct_source_dir/benchmark.cpp" -o "$ct_build_dir/benchmark"
"$ct_build_dir/benchmark" "$@"
