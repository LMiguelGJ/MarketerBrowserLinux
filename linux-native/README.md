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

## The buttons of the viewer

The viewer shows the shared screen full-viewport, with three floating buttons on
the top right:

- **App** brings the application window to the front.
- **Navegador** brings the browser of the profile to the front, and starts it if
  it is not running yet.
- **Error** shows the last thing the application logged, on the shared screen.

The buttons send a key combination over the VNC connection; the window manager
runs the matching script inside the container. No extra port and no backend.

Two behaviours of the application shape these buttons:

- The application **hides its own window** while a profile runs, and hides it
  again when it loses the focus. It is therefore found by class, not by title:
  while a modal box is open the title is not `MainForm` any more.
- The browser **restores its own saved bounds** shortly after it opens, so its
  size is enforced on every pass of the watchdog.

## Starting a profile

The application cannot start a profile by itself under Wine. Its log says:

```text
Preparing to start browser -> Creating browser -> Read proxy IP
-> Analyzing proxy IP -> Failed to analyze IP, please check if your proxy can
be used normally or try again
```

The browser is never launched, and because the application hides its window to
launch it, the shared screen turns black with nothing to click.

Two independent things are in the way:

1. The proxy helper (`S5Proxyer`, `nfdriver.sys`, `SocksRedirectorNet`) needs a
   Windows **kernel network driver**, which cannot load under Wine.
2. The .NET Framework 4.8 of the prefix only offers TLS 1.0 and 1.1 by default
   (`ServicePointManager.SecurityProtocol` is `Ssl3, Tls`), and modern
   endpoints refuse it: `https://api.ipify.org` fails with *Could not create
   SSL/TLS secure channel* while plain HTTP works. Forcing TLS 1.2 in code
   makes the same request succeed, so the analysis in the log is very likely
   this. There is no configuration-only way to change the default: the root
   certificate store, `SystemDefaultTlsVersion` in both registry views,
   `SecureProtocols`, `machine.config` and an `app.config` all had no effect.

The Chromium that the application downloads **does** run under Wine, so the
**Navegador** button starts it directly, on the same screen, with the same
profile directory. It is a plain browser window: it does not carry the
application's proxy settings, because the application never got as far as
creating the profile.

To get the full flow, with the application's own proxy handling, the
application has to run on real Windows. Under Wine the profile launch cannot
complete.

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
Profile startup has the known Wine limitation described above: the application
stops at *Analyzing proxy IP* and never starts the browser. The **Navegador**
button of the viewer starts the browser it downloaded instead.
