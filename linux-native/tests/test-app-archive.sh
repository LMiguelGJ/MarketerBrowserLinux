#!/usr/bin/env bash
# Contract of the build-context model: the pinned archive travels in the
# repository, a private build stage verifies both hashes, and the final image
# receives only the extracted program.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/Dockerfile"
ENTRYPOINT="$ROOT/docker/entrypoint.sh"
DOCKERIGNORE="$ROOT/.dockerignore"
ARCHIVE="$ROOT/MarketerBrowserLite-1.0.0.1.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -r "$ARCHIVE" ]] || fail "the pinned archive is missing: $ARCHIVE"
[[ -r "$DOCKERFILE" ]] || fail "Dockerfile is missing"
[[ -r "$ENTRYPOINT" ]] || fail "entrypoint is missing"

# The Dockerfile pins both hashes; the archive and the extracted executable must
# match them, otherwise the build must fail instead of shipping a wrong binary.
zip_sha="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
pinned_zip="$(sed -n 's/^ARG APP_ZIP_SHA256=\([0-9a-f]*\)$/\1/p' "$DOCKERFILE")"
[[ -n "$pinned_zip" ]] || fail "Dockerfile does not pin APP_ZIP_SHA256"
[[ "$zip_sha" == "$pinned_zip" ]] || \
  fail "archive SHA-256 mismatch: got $zip_sha, pinned $pinned_zip"

unzip -q "$ARCHIVE" -d "$TMP/app" 2>/dev/null || \
  unzip -q "$ARCHIVE" -d "$TMP/app"
exe_path="$TMP/app/MarketerBrowserLite.exe"
[[ -f "$exe_path" ]] || fail "the archive has no MarketerBrowserLite.exe"
[[ -d "$TMP/app/Data" ]] || fail "the archive has no initial Data directory"
exe_sha="$(sha256sum "$exe_path" | cut -d' ' -f1)"
pinned_exe="$(sed -n 's/^ARG APP_EXE_SHA256=\([0-9a-f]*\)$/\1/p' "$DOCKERFILE")"
[[ -n "$pinned_exe" ]] || fail "Dockerfile does not pin APP_EXE_SHA256"
[[ "$exe_sha" == "$pinned_exe" ]] || \
  fail "executable SHA-256 mismatch: got $exe_sha, pinned $pinned_exe"

# The archive is copied only inside the private stage. The final stage must
# receive the extracted program, never the archive.
grep -q 'FROM debian:trixie-slim AS app-archive' "$DOCKERFILE" || \
  fail "Dockerfile has no private app-archive stage"
grep -q 'COPY MarketerBrowserLite-1.0.0.1.zip /tmp/app.zip' "$DOCKERFILE" || \
  fail "Dockerfile does not copy the archive into the private stage"
[[ "$(grep -c '^COPY MarketerBrowserLite-1.0.0.1.zip' "$DOCKERFILE")" == 1 ]] || \
  fail "the archive is copied outside the private stage"
grep -q 'COPY --from=app-archive' "$DOCKERFILE" || \
  fail "Dockerfile does not copy the extracted program from the private stage"

# The build context must carry this archive and still exclude every other one.
grep -qxF '!MarketerBrowserLite-1.0.0.1.zip' "$DOCKERIGNORE" || \
  fail ".dockerignore does not re-include the pinned archive"
grep -qxF '**/*.zip' "$DOCKERIGNORE" || \
  fail ".dockerignore does not exclude other archives"

# The startup gate survives: a missing token stops the container before the
# application is launched.
entrypoint_code=0
env -u MBL_ACCESS_TOKEN bash "$ENTRYPOINT" \
  >"$TMP/token-stdout" 2>"$TMP/token-stderr" || entrypoint_code=$?
[[ "$entrypoint_code" == 64 ]] || fail "missing token should exit 64, got $entrypoint_code"
[[ ! -s "$TMP/token-stdout" ]] || fail 'missing token wrote to stdout'
expected_token_error=$'MBL_ACCESS_TOKEN is required: 16-128 characters from [A-Za-z0-9_-].\nGenerate one with: openssl rand -hex 24'
[[ "$(cat "$TMP/token-stderr")" == "$expected_token_error" ]] || fail 'missing token error changed'

echo 'PASS: pinned archive hashes, private stage, build context and startup gate'
