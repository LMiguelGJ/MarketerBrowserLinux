# MarketerBrowserLite under Wine

This image runs the original MarketerBrowserLite 1.0.0.1 Windows application
under Wine and presents its screen through noVNC on port 6080.

## The application archive

The pinned archive `MarketerBrowserLite-1.0.0.1.zip` lives in this directory
and travels in the repository, because Dokploy builds from a Git checkout: the
build has to receive the archive to produce an image that contains the
application.

The build verifies the archive before using it. A private stage checks the
SHA-256 of the ZIP and of the extracted `MarketerBrowserLite.exe` against the
pinned values in the `Dockerfile`; a mismatch fails the build. The final image
receives only the extracted program, never the archive itself.

The vendor URL (`https://www.marketerbrowser.com/Doc/MarketerBrowserLite.zip`)
now serves a newer build that does not start under this Wine setup and reports
a missing .NET Framework. The pinned archive is the known-good 1.0.0.1 release.

## Persistence

`/data` holds everything that must survive a redeploy: the application's own
data, its profiles, and the components it downloads (proxy helper, Chrome-based
browser) into `C:\ProgramData` inside the Wine prefix. The entrypoint
redirects those paths into `/data` and symlinks them back, so the container
writes only to the volume.

Mount `/data` as a **named** volume. An anonymous volume is discarded when the
container is replaced, and a redeploy replaces the container.

In Dokploy, add the volume under the application's Volumes/Mounts settings
(named volume `mbl-data`, mount path `/data`). Dokploy only forwards named
volumes to the container; a host path bind is not applied.

## Build and run locally

From this directory:

```sh
docker build -t marketerbrowser-linux:1.0.0.1 .
docker run --rm -p 6080:6080 --shm-size=1g \
  -e MBL_ACCESS_TOKEN="$(openssl rand -hex 24)" \
  -v mbl-data:/data \
  marketerbrowser-linux:1.0.0.1
```

For `docker compose`, set `MBL_ACCESS_TOKEN`; the compose file mounts the
named `mbl-data` volume at `/data`. Open `http://localhost:6080/` and enter the
token. Keep port 5900 private.

## Dokploy settings

- Source: this repository's `main` branch.
- Build path/context: `linux-native`.
- Dockerfile: `Dockerfile`.
- Container port: `6080` (HTTPS recommended).
- Runtime environment: `MBL_ACCESS_TOKEN`, generated with `openssl rand -hex 24`.
- Named volume: `mbl-data` at `/data`.
- Shared memory: at least `1gb`.

The image build alone does not establish that launching a browser profile works.
Profile startup currently has a separate known Wine limitation: the app reports
`Failed to analyze IP`.
