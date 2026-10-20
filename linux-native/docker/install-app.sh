#!/usr/bin/env bash
# Install the verified, read-only vendor ZIP into the persistent data volume once.
set -euo pipefail

DATA_DIR="${MBL_DATA_DIR:-/data}"
APP_DIR="${MBL_APP_DIR:-$DATA_DIR/app}"
VENDOR_ZIP="${MBL_VENDOR_ZIP:-/run/mbl-private/MarketerBrowserLite-1.0.0.1.zip}"
EXPECTED_ZIP_SHA256=2c0afda87e9ce896bff34dcf41f5bc4b1abbf099096fef20fd7ba47b1c275570
EXPECTED_EXE_SHA256=0c8d2c489aa22776f8e3ac5ab8cd8e70ef39ad22f4bce4f343e322a219d7994f

if [[ -f "$APP_DIR/MarketerBrowserLite.exe" ]]; then
  actual_exe_sha256="$(sha256sum "$APP_DIR/MarketerBrowserLite.exe" | cut -d' ' -f1)"
  if [[ "$actual_exe_sha256" != "$EXPECTED_EXE_SHA256" ]]; then
    echo "install-app: existing executable SHA-256 mismatch; refusing to replace persisted app" >&2
    exit 65
  fi
  echo 'install-app: existing application verified'
  exit 0
fi

if [[ -e "$APP_DIR" ]]; then
  echo "install-app: incomplete install directory exists: $APP_DIR; refusing to overwrite" >&2
  exit 73
fi

if [[ ! -f "$VENDOR_ZIP" || ! -r "$VENDOR_ZIP" ]]; then
  echo "install-app: private archive not found: $VENDOR_ZIP" >&2
  exit 66
fi

actual_zip_sha256="$(sha256sum "$VENDOR_ZIP" | cut -d' ' -f1)"
if [[ "$actual_zip_sha256" != "$EXPECTED_ZIP_SHA256" ]]; then
  echo 'install-app: archive SHA-256 mismatch; refusing to extract' >&2
  exit 65
fi

mkdir -p "$DATA_DIR"
staging_dir="$(mktemp -d "$DATA_DIR/.app-unpack.XXXXXX")"
cleanup() {
  if [[ -n "${staging_dir:-}" && -d "$staging_dir" ]]; then
    rm -rf -- "$staging_dir"
  fi
}
trap cleanup EXIT

unzip -q "$VENDOR_ZIP" -d "$staging_dir"
exe_path="$staging_dir/MarketerBrowserLite.exe"
if [[ ! -f "$exe_path" || ! -d "$staging_dir/Data" ]]; then
  echo 'install-app: archive is missing the expected executable or Data directory' >&2
  exit 65
fi

actual_exe_sha256="$(sha256sum "$exe_path" | cut -d' ' -f1)"
if [[ "$actual_exe_sha256" != "$EXPECTED_EXE_SHA256" ]]; then
  echo 'install-app: executable SHA-256 mismatch; refusing to install' >&2
  exit 65
fi

mv -- "$staging_dir" "$APP_DIR"
staging_dir=''
echo 'install-app: installed MarketerBrowserLite 1.0.0.1'
