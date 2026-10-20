# Laboratorio de pruebas — Kali WSL 2

Entorno de desarrollo y pruebas del prototipo Linux nativo. **No es la imagen de
producción**: la imagen candidata de producción es Debian, tal como indica el
Dockerfile de referencia.

## Distribuciones WSL registradas

Salida de `wsl.exe --list --verbose`:

```text
NAME              STATE           VERSION
kali-linux        Stopped         2
Ubuntu-24.04      Stopped         2
```

Ambas en WSL 2. Kali es el laboratorio; Ubuntu queda como alternativa.

## Preflight 2026-03-27 — resultados reales

Este registro documenta lo que **ocurrió**, no lo que se esperaba. Las tres
diferencias importaron.

### 1. No había motor de contenedores ni Node

```text
wsl.exe -d kali-linux -- sh -lc 'command -v docker; command -v node; command -v npm; command -v python3'
  NO_DOCKER
  NO_NODE
  /mnt/c/Program Files/nodejs/npm      <- npm de Windows por interoperabilidad
  /usr/bin/python3
```

El `npm` visible desde WSL es el binario de **Windows** a través de `/mnt/c`. No
es usable para paquetes nativos de Linux: instalarlo desde ahí produce
binarios con rutas de Windows.

En el host Windows tampoco hay Docker: `docker` no existe ni Docker Desktop.

### 2. `sudo` requiere contraseña: el bloqueo silencioso

El primer intento de instalación se quedó **13 minutos sin avanzar**. La causa no
era la red, que funciona (`http.kali.org` responde 200 en 0,27 s), sino esto:

```text
sudo -n true  ->  sudo: a password is required
```

El proceso `sudo apt-get update` esperaba un prompt de contraseña que, en un
contexto sin TTY, nunca llega. El síntoma —un `apt-get` colgado sin errores—
es indistinguible de un problema de red si no se revisa el estado de `sudo`.

**Regla para este laboratorio:** las operaciones privilegiadas se ejecutan como
root vía `wsl.exe -d kali-linux -u root --`, que no pide credenciales.

```text
wsl.exe -d kali-linux -u root -- bash -lc 'apt-get install -y ...'
```

El mismo problema apareció en `npx playwright install --with-deps`,
que invoca `sudo` internamente. Se resolvió instalando las dependencias del
sistema con `apt-get` como root y ejecutando después
`npx playwright install chromium` sin `--with-deps`.

### 3. Kali separa el cliente de Docker del demonio

```text
dpkg -l | grep docker  ->  ii containerd 2.1.9+ds1-2
                            ii docker.io   28.5.2+dfsg4-4
```

`docker.io` instala `dockerd` y `docker-proxy`, **no** el binario `docker`. El
cliente vive en el paquete `docker-cli`:

```text
apt-get install -y docker-cli docker-compose
```

Tras la instalación, el usuario de laboratorio tampoco tenía permiso sobre el
socket, y el build fallaba con `permission denied while trying to connect to
the Docker daemon socket`. Corrección aplicada:

```text
usermod -aG docker kali
```

## Estado final del laboratorio

| Componente | Versión | Notas |
| --- | --- | --- |
| Node.js | 24.19.0 | De los repos de Kali. El prototipo acepta Node >= 22. |
| npm | 11.19.0 | Instalado en Linux, no el de Windows. |
| Docker | 28.5.2 | Demonio por systemd, driver `overlay2`. |
| Docker Compose | v2 (paquete `docker-compose`) | |
| Chromium (Playwright) | 131.0.6778.33 | Descargado en `~/.cache/ms-playwright`. |

El demonio arranca con systemd, que Kali ya traía activo (`cgroup2fs`):

```text
wsl.exe -d kali-linux -u root -- systemctl enable --now docker
```

Kali reporta `systemctl is-system-running` como `degraded`, sin relación con
Docker: el estado degradado viene de unidades no críticas del sistema base.

## Montaje del workspace desde WSL

El workspace vive en OneDrive y se ve en Kali como `/mnt/c/...`.

```text
lectura de un archivo de prueba desde /mnt/c: ~0,5 s
```

Suficiente para editar y ejecutar pruebas, con una advertencia: `node_modules`
dentro de OneDrive es lentísimo y frágil. Por eso las dependencias se instalan
en una copia de trabajo bajo el HOME de Kali y el código se sincroniza desde el
workspace, nunca al revés.

`rsync` no está instalado en Kali, así que la sincronización usa `tar`:

```text
cd "/mnt/c/.../MarketerBrowserLite/linux-native" \
  && tar --exclude=node_modules --exclude=.git -cf - . \
  | (cd ~/work/mbl-src && tar -xf -)
```

Estructura de trabajo en Kali:

```text
~/work/mbl-src        copia de trabajo (node_modules dentro)
~/work/mbl-state      estado del laboratorio: bases, perfiles de prueba, registros
```

El estado vive fuera del workspace porque contiene datos de prueba generados y
porque el workspace está en un disco sincronizado.

## Reglas de aislamiento del laboratorio

- Solo se usa `linux-native/` del workspace y directorios bajo `~/work/mbl-src` y
  `~/work/mbl-state`.
- **Nunca** se copia `Data/`, `Backups/`, `BackupTemp/`, `Logs/`, cookies, claves
  ni perfiles del usuario al laboratorio.
- Los perfiles de prueba se crean desde cero con datos sintéticos.
- Las pruebas Docker usan nombres de proyecto y volúmenes con sufijo de
  laboratorio; la limpieza solo toca recursos creados por la suite, jamás
  volúmenes preexistentes.

## Comandos de referencia

```text
# Preflight sin efectos secundarios
wsl.exe -d kali-linux -- uname -m
wsl.exe -d kali-linux -- sh -lc 'command -v node; node -v; command -v npm; npm -v'
wsl.exe -d kali-linux -- sh -lc 'command -v docker; docker version; docker compose version'

# Sincronizar el código del workspace a la copia de trabajo.
# Sustituir <WIN_USER> por el usuario de Windows y <PATH> por la ruta del repositorio.
wsl.exe -d kali-linux -- bash -lc 'cd "/mnt/c/Users/<WIN_USER>/<PATH>/linux-native" && tar --exclude=node_modules --exclude=.git -cf - . | (cd ~/work/mbl-src && tar -xf -)'

# Ejecutar una suite
wsl.exe -d kali-linux -- bash -lc 'cd ~/work/mbl-src && npm run test:unit'
```

## Limitaciones

- El servicio dentro de Docker no es accesible desde Windows por `localhost`
  mientras el demonio viva dentro de WSL, salvo que se publique un puerto en
  WSL2 con `localhostForwarding` o se use la IP de WSL. La verificación E2E se
  hace desde dentro de la misma distribución.
- Kali es laboratorio: no se usa como base de la imagen final.
