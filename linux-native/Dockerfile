# mbl-linux-native — runtime Linux de la interfaz web de gestión de perfiles.
#
# Build:  docker build -t mbl-linux-native .
# Run:    docker compose up -d
#
# Base Debian: el motor de navegador y sus dependencias son más estables ahí
# que en Kali, que queda como laboratorio de desarrollo.
#
# Node 22: la imagen oficial node:22-bookworm-slim ya incluye Node 22.
# El motor de navegador se descarga durante el build para que el contenedor
# arranque sin red.

FROM node:22-bookworm-slim

# Dependencias de sistema del navegador y del servidor de visualización.
# ffmpeg es opcional para el visor, pero las bibliotecas de X11/GTK/ATK sí
# son necesarias para que el navegador headless renderice sin errores.
# hadolint ignore=DL3008
# Las versiones exactas de apt no se fijan a propósito: la imagen base
# parcheada recibe actualizaciones de seguridad y fijar el número de versión
# rompería el build en cuanto el mirror retire esa versión.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libexpat1 \
        libfontconfig1 \
        libgbm1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxss1 \
        libxtst6 \
        xauth \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Usuario no-root desde el principio: el navegador se descarga en su HOME y
# los perfiles se escriben en el volumen de datos. El directorio del volumen se
# crea aquí, todavía como root, para que herede el ownership del usuario de
# runtime: un volumen con nombre vacío copia los permisos de la imagen.
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid 1001 --create-home app \
    && chown app:app /app \
    && mkdir -p /data && chown app:app /data
# UID numérico: evita depender de la resolución de nombres en el runtime.
USER 1001
ENV HOME=/home/app

COPY --chown=app:app package.json package-lock.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev --no-audit --no-fund

# Descarga del navegador en el build (como el usuario de runtime), no en cada
# arranque: el contenedor debe poder arrancar sin red.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/app/.cache/ms-playwright
RUN npx playwright install chromium

COPY --chown=app:app . .

ENV NODE_ENV=production \
    MBL_HOST=0.0.0.0 \
    MBL_PORT=3000 \
    MBL_DATA_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/home/app/.cache/ms-playwright

# El sandbox de Chromium necesita namespaces de usuario, que compose bloquea con
# cap_drop ALL y no-new-privileges. El aislamiento lo aporta el contenedor
# (usuario no-root, sin capacidades); se desactiva aquí de forma explícita en
# lugar de depender de un valor fijo en el código.
ENV MBL_BROWSER_SANDBOX=false

VOLUME ["/data"]
EXPOSE 3000

# El servicio se considera sano cuando responde /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--experimental-sqlite", "server.js"]
