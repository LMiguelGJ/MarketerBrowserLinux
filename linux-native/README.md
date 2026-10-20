# MarketerBrowserLite under Wine

This image runs the original MarketerBrowserLite 1.0.0.1 Windows application under Wine and presents its screen through noVNC on port 6080.

## Private application archive

The vendor now serves a newer build that does not start in this Wine setup. Keep the known-good archive `MarketerBrowserLite-1.0.0.1.zip` **beside the Dockerfile locally**, but never add it to GitHub. `.gitignore` excludes it, and `.dockerignore` keeps it out of the image build context.

At container startup, mount the ZIP read-only at:

```text
/run/mbl-private/MarketerBrowserLite-1.0.0.1.zip
```

On a fresh `/data` volume, the entrypoint verifies the ZIP and executable SHA-256 values before extracting to `/data/app`. If the archive is missing or invalid, startup fails before creating or changing app data. After installation, `/data/app` persists across restarts; the executable is hash-checked and reused. The ZIP is not included in the image.

## Prepare the Dokploy host

1. Securely copy the ZIP from your workstation to a private directory on the Dokploy Docker host, outside the Git checkout; for example:
   `/opt/marketerbrowser-private/MarketerBrowserLite-1.0.0.1.zip`.
2. Make the file readable by the container's UID/GID `1001:1001` (the default host permissions can be `root:1001`, directory `0750`, file `0640`). Adjust for Docker user-namespace remapping if enabled.
3. Add a **read-only bind mount** in Dokploy:
   - Host source: `/opt/marketerbrowser-private/MarketerBrowserLite-1.0.0.1.zip`
   - Container target: `/run/mbl-private/MarketerBrowserLite-1.0.0.1.zip`
   - Read-only: enabled

The normal GitHub checkout can now build the image without the ZIP. Do not store the archive in the repository or in the image.

## Build and run locally

From this directory:

```sh
docker build -t marketerbrowser-linux:1.0.0.1 .
docker run --rm -p 6080:6080 --shm-size=1g \
  -e MBL_ACCESS_TOKEN="$(openssl rand -hex 24)" \
  -v mbl-data:/data \
  -v "$(pwd)/MarketerBrowserLite-1.0.0.1.zip:/run/mbl-private/MarketerBrowserLite-1.0.0.1.zip:ro" \
  marketerbrowser-linux:1.0.0.1
```

For `docker compose`, set `MBL_VENDOR_ZIP_HOST_PATH` to the archive's absolute host path and set `MBL_ACCESS_TOKEN`; the compose file mounts the archive read-only. Open `http://localhost:6080/` and enter the token. Keep port 5900 private. Persist `/data` because it contains the app, profiles, and downloaded browser components.

## Dokploy settings

- Source: this repository's `main` branch.
- Build path/context: `linux-native`.
- Dockerfile: `Dockerfile`.
- Container port: `6080` (HTTPS recommended).
- Runtime environment: `MBL_ACCESS_TOKEN`, generated with `openssl rand -hex 24`.
- Persistent volume: `/data`.
- Additional read-only host bind mount: use the source and target paths above.
- Shared memory: at least `1gb`.

The image build alone does not establish that launching a browser profile works. Profile startup currently has a separate known Wine limitation: the app reports `Failed to analyze IP`.
