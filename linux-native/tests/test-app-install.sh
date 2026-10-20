#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/docker/install-app.sh"
ARCHIVE="$ROOT/MarketerBrowserLite-1.0.0.1.zip"
EXPECTED_EXE_SHA256=0c8d2c489aa22776f8e3ac5ab8cd8e70ef39ad22f4bce4f343e322a219d7994f
TMP="$(mktemp -d "$ROOT/.test-app-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Preserve the existing startup gate: a missing token exits before installation.
entrypoint_code=0
env -u MBL_ACCESS_TOKEN bash "$ROOT/docker/entrypoint.sh" \
  >"$TMP/token-stdout" 2>"$TMP/token-stderr" || entrypoint_code=$?
[[ "$entrypoint_code" == 64 ]] || fail "missing token should exit 64, got $entrypoint_code"
[[ ! -s "$TMP/token-stdout" ]] || fail 'missing token wrote to stdout'
expected_token_error=$'MBL_ACCESS_TOKEN is required: 16-128 characters from [A-Za-z0-9_-].\nGenerate one with: openssl rand -hex 24'
[[ "$(cat "$TMP/token-stderr")" == "$expected_token_error" ]] || fail 'missing token error changed'

run_installer() {
  local data_dir="$1"
  local archive="$2"
  local expected_code="$3"
  local expected_stdout="$4"
  local expected_stderr="$5"
  local actual_code=0

  env MBL_DATA_DIR="$data_dir" MBL_VENDOR_ZIP="$archive" \
    bash "$INSTALLER" >"$TMP/stdout" 2>"$TMP/stderr" || actual_code=$?

  [[ "$actual_code" == "$expected_code" ]] || \
    fail "expected exit $expected_code, got $actual_code; stderr: $(cat "$TMP/stderr")"
  [[ "$(cat "$TMP/stdout")" == "$expected_stdout" ]] || \
    fail "unexpected stdout: $(cat "$TMP/stdout")"
  [[ "$(cat "$TMP/stderr")" == "$expected_stderr" ]] || \
    fail "unexpected stderr: $(cat "$TMP/stderr")"
}

# A missing read-only mount must fail before creating or modifying persistent data.
missing_data="$TMP/missing-data"
mkdir -p "$missing_data"
printf 'keep-existing-data\n' >"$missing_data/keep.txt"
run_installer "$missing_data" "$TMP/not-mounted.zip" 66 \
  '' "install-app: private archive not found: $TMP/not-mounted.zip"
[[ "$(cat "$missing_data/keep.txt")" == keep-existing-data ]] || fail 'missing mount changed existing data'
[[ ! -e "$missing_data/app" ]] || fail 'missing mount created an app directory'

# A mounted but untrusted/corrupt archive must be rejected before extraction.
invalid_data="$TMP/invalid-data"
mkdir -p "$invalid_data"
printf 'keep-existing-data\n' >"$invalid_data/keep.txt"
printf 'not a zip archive\n' >"$TMP/invalid.zip"
run_installer "$invalid_data" "$TMP/invalid.zip" 65 \
  '' 'install-app: archive SHA-256 mismatch; refusing to extract'
[[ "$(cat "$invalid_data/keep.txt")" == keep-existing-data ]] || fail 'bad archive changed existing data'
[[ ! -e "$invalid_data/app" ]] || fail 'bad archive created an app directory'

# The known-good private archive is verified and extracted on first startup.
[[ -r "$ARCHIVE" ]] || fail "private test archive is unavailable: $ARCHIVE"
valid_data="$TMP/valid-data"
run_installer "$valid_data" "$ARCHIVE" 0 \
  'install-app: installed MarketerBrowserLite 1.0.0.1' ''
[[ -f "$valid_data/app/MarketerBrowserLite.exe" ]] || fail 'application executable was not installed'
[[ -d "$valid_data/app/Data" ]] || fail 'initial app Data directory was not installed'
actual_exe_sha256="$(sha256sum "$valid_data/app/MarketerBrowserLite.exe" | cut -d' ' -f1)"
[[ "$actual_exe_sha256" == "$EXPECTED_EXE_SHA256" ]] || fail "installed EXE hash mismatch: $actual_exe_sha256"

# A restart reuses the persistent install and does not need to extract the ZIP again.
printf 'preserve-me\n' >"$valid_data/app/.test-sentinel"
run_installer "$valid_data" "$TMP/not-mounted.zip" 0 \
  'install-app: existing application verified' ''
[[ "$(cat "$valid_data/app/.test-sentinel")" == preserve-me ]] || fail 'restart changed the existing installation'

echo 'PASS: app install mount, hash validation, extraction, and restart preservation'
