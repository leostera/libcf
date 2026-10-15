#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

find_tool() {
  local name=$1 override=$2
  if [[ -n "$override" ]]; then
    printf '%s\n' "$override"
  elif command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
  elif [[ -x "/opt/homebrew/opt/llvm/bin/$name" ]]; then
    printf '/opt/homebrew/opt/llvm/bin/%s\n' "$name"
  else
    echo "Missing $name; install LLVM or set CLANG_FORMAT / CLANG_TIDY to the executable path" >&2
    exit 1
  fi
}

case "${1:-}" in
  format|format-check)
    formatter=$(find_tool clang-format "${CLANG_FORMAT:-}")
    args=(-i)
    [[ $1 == format-check ]] && args=(--dry-run --Werror)
    git ls-files -z -- '*.cpp' '*.hpp' | xargs -0 "$formatter" "${args[@]}"
    ;;
  lint)
    tidy=$(find_tool clang-tidy "${CLANG_TIDY:-}")
    cmake -S . -B build/lint -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
    extra=()
    if [[ $(uname) == Darwin ]]; then
      extra=(--extra-arg=-isysroot "--extra-arg=$(xcrun --show-sdk-path)")
    fi
    # Native compilation database covers the library headers and native tests.
    "$tidy" -p build/lint "${extra[@]}" tests/native/{core,storage,d1,events}.cpp
    ;;
  *)
    echo 'Usage: scripts/cpp-tools.sh {format|format-check|lint}' >&2
    exit 2
    ;;
esac
