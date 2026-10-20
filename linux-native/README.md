# MarketerBrowserLite under Wine

This image runs the original MarketerBrowserLite 1.0.0.1 Windows application under Wine and presents its screen through noVNC on port 6080.

## Required private vendor archive

The vendor now serves a newer build that does not start in this Wine setup. The image therefore requires the known-good **1.0.0.1** archive at:

```text
linux-native/MarketerBrowserLite-1.0.0.1.zip
```

The archive is deliberately ignored by Git and must never be committed or uploaded to GitHub. The Docker build verifies the ZIP and executable SHA-256 hashes, then extracts the application into the image. It does not download the vendor's moving URL.

**Important for Dokploy:** a GitHub-based build gets a fresh checkout and will not contain this ignored file. Before deploying, make the archive available inside the Dokploy Docker build context using a private method you control. If that cannot be arranged, build the image on a machine that has the archive and deploy that image through a private container registry. Neither route is configured by this repository; do not start a deployment until the builder has the archive.

## Build and run locally

From this directory, with the private archive present:

```sh
docker build -t marketerbrowser-linux:1.0.0.1 .
docker run --rm -p 6080:6080 \
  -e MBL_ACCESS_TOKEN="$(openssl rand -hex 24)" \
  -v mbl-data:/data --shm-size=1g marketerbrowser-linux:1.0.0.1
```

Open `http://localhost:6080/` and enter the same token. Keep port 5900 private; only 6080 serves the authenticated viewer. Persist `/data` because the app stores profiles and downloaded browser components there.

## Dokploy settings

- Source: this repository's `main` branch.
- Build path/context: `linux-native`.
- Dockerfile: `Dockerfile`.
- Container port: `6080` (HTTPS recommended).
- Runtime environment: `MBL_ACCESS_TOKEN`, generated with `openssl rand -hex 24`.
- Persistent volume: `/data`.
- Shared memory: at least `1gb`.
- Ensure the private 1.0.0.1 ZIP is present in the builder's context before triggering the build; a normal GitHub checkout does not include it.

The image build alone does not establish that launching a browser profile works. Profile startup currently has a separate known Wine limitation: the app reports `Failed to analyze IP`.
