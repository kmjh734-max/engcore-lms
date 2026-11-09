#!/usr/bin/env bash
# 커밋 전 빠른 검사(2026-11-09): next lint 전체(램 8GB에서 6분+) 대신
# 타입 검사(증분) + 바뀐 src 파일만 eslint(캐시). 통과하면 exit 0.
# 쓰기: bash scripts/quick-check.sh [파일...]   (파일 생략 시 git 에서 바뀐 src/*.ts(x))
cd "$(dirname "$0")/.." || exit 1
files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  mapfile -t files < <( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard; } | grep -E '^src/.*\.(ts|tsx)$' | sort -u)
fi
fail=0
tsc_err=$(npx tsc --noEmit 2>&1 | grep -E '^src/')
if [ -n "$tsc_err" ]; then echo "== 타입 오류"; echo "$tsc_err"; fail=1; else echo "타입 검사 통과"; fi
if [ ${#files[@]} -gt 0 ]; then
  if ESLINT_USE_FLAT_CONFIG=false npx eslint --cache --cache-location node_modules/.cache/eslint/ --quiet "${files[@]}" 2>/dev/null; then
    echo "린트 통과 (${#files[@]}개 파일)"
  else
    echo "== 린트 오류"; fail=1
  fi
else
  echo "바뀐 src 파일 없음 — 린트 생략"
fi
exit $fail
