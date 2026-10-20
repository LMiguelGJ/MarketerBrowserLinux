# MarketerBrowserLite (the original Windows application) running under Wine,
# shown in a browser tab through noVNC.
#
# The application binary is NOT part of this repository: it is downloaded from the
# vendor's official URL while building, and its SHA-256 is verified.
#
# Build:  docker build -t marketerbrowser-linux .
# Run:    docker run -p 6080:6080 -e MBL_ACCESS_TOKEN=$(openssl rand -hex 24) \
#                    -v mbl-data:/data --shm-size=1g marketerbrowser-linux
#
# Debian 13 (trixie) ships Wine 10, the version this setup was validated with.
FROM debian:trixie-slim

# A failure anywhere in a piped command must fail the build.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG DEBIAN_FRONTEND=noninteractive
ARG WINETRICKS_VERSION=20260125
ARG WINETRICKS_SHA256=431f82fc74000e6c864409f1d8fb495d696c03928808e3e8acffc45179312a7b
ARG APP_ZIP_URL=https://www.marketerbrowser.com/Doc/MarketerBrowserLite.zip
# The vendor replaces the file at this URL whenever it releases a new version (it did,
# between two builds on the same day), so pinning a hash makes builds fail without any
# attack involved. The default accepts the current file and prints its SHA-256 in the
# build log. To pin a known build, pass its hash, e.g.
#   --build-arg APP_ZIP_SHA256=cfe86ad3c1dc0146748b9b6e740f1b61940aeac3be4f540c0ac6b792011d3fb3
ARG APP_ZIP_SHA256=any

# hadolint ignore=DL3008
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl wget unzip cabextract tini procps \
        wine wine32 wine64 libwine fonts-liberation fonts-wine \
        xvfb xauth x11-utils xdotool wmctrl openbox x11vnc \
        novnc websockify \
    && rm -rf /var/lib/apt/lists/* \
    && test -f /usr/share/novnc/core/rfb.js

RUN groupadd --gid 1001 app \
    && useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash app \
    && mkdir -p /data /opt/mbl-app /opt/mbl-dist /opt/mbl \
    && chown -R app:app /data /opt/mbl-app /opt/mbl-dist /opt/mbl

# winetricks, pinned by version and checked by hash.
RUN curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors -o /usr/local/bin/winetricks \
        "https://raw.githubusercontent.com/Winetricks/winetricks/${WINETRICKS_VERSION}/src/winetricks" \
    && echo "${WINETRICKS_SHA256}  /usr/local/bin/winetricks" | sha256sum -c - \
    && chmod 755 /usr/local/bin/winetricks

# Never run Wine as root.
USER 1001
ENV HOME=/home/app \
    WINEPREFIX=/home/app/.wine \
    WINEDEBUG=fixme-all \
    LANG=C.UTF-8

# UseTakeFocus=N: without it the window manager keeps the keyboard focus on the main
# window and the application's side panels (separate windows) never receive typing.
#
# 64-bit prefix (it also runs 32-bit programs). The components the application
# downloads on its own, such as its Chrome-based browser, are x86-64 and cannot
# run in a 32-bit prefix. .NET Framework 4.8 is installed for real: the
# application's code protection needs the genuine runtime, not Mono.
RUN WINEDLLOVERRIDES="mscoree,mshtml=" xvfb-run -a wineboot -u \
    && wineserver -w \
    && xvfb-run -a winetricks -q corefonts dotnet48 \
    && wineserver -w \
    && wine reg add "HKCU\\Software\\Wine\\WineDbg" /v ShowCrashDialog /t REG_DWORD /d 0 /f \
    && wine reg add "HKCU\\Software\\Wine\\X11 Driver" /v UseTakeFocus /t REG_SZ /d N /f \
    && wineserver -w \
    && rm -rf "$HOME/.cache/winetricks" /tmp/*

# The application, from the vendor, verified.
# The vendor server sometimes drops the connection halfway through the 44 MB file,
# hence the retries.
RUN curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors -o /tmp/app.zip "${APP_ZIP_URL}" \
    && if [ "${APP_ZIP_SHA256}" != "any" ]; then \
         echo "${APP_ZIP_SHA256}  /tmp/app.zip" | sha256sum -c - ; \
       fi \
    && unzip -q /tmp/app.zip -d /opt/mbl-app \
    && test -f /opt/mbl-app/MarketerBrowserLite.exe \
    && mv /opt/mbl-app/Data /opt/mbl-dist/Data \
    && sha256sum /tmp/app.zip /opt/mbl-app/MarketerBrowserLite.exe | tee /opt/mbl-app/.build-sha256 \
    && rm -f /tmp/app.zip

COPY --chown=1001:1001 docker/ /opt/mbl/
RUN chmod 755 /opt/mbl/*.sh

ENV DISPLAY=:99 \
    SCREEN=1600x900x24 \
    WEB_PORT=6080 \
    MBL_APP_DIR=/opt/mbl-app \
    MBL_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 6080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:6080/"]

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mbl/entrypoint.sh"]
