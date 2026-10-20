# Plan: la app original corriendo en Linux y mostrada en una pestaña

> Creado con `plan-mode-trae`. Estado: **aprobado; en implementación**. El ZIP propietario viaja en el repositorio: Dokploy construye desde un checkout de Git, así que el archivo tiene que estar en el repo para que la imagen contenga la app. Un stage privado de build verifica ambos hashes y la imagen final recibe solo lo extraído.
> Reemplaza la dirección del plan anterior (`migracion-linux-nativa.md`, reimplementación), que no cumplió el pedido.

## Summary

Ejecutar el **`MarketerBrowserLite.exe` original** bajo Wine en una pantalla virtual de Linux y servir esa pantalla a una pestaña web (noVNC), de modo que el navegador muestre **solo la ventana de la app, tal cual**, con ratón y teclado. Todo empaquetado en Docker y desplegable en Dokploy. El ZIP propietario viaja en el checkout de Git porque Dokploy construye desde ahí; un stage privado del build verifica los hashes del ZIP y del EXE extraído, y la imagen final recibe solo el programa extraído, nunca el archivo.

## Pedido original (L1, textual)

> «lo que te pedi fue pasar toda la app de web nativo a linux nativo y luego lo unico que tiene que hacer es levantar una web que solo muestre esa aplicacion abierto osea el envie al dom el video de la pantalla de ese linux pero solo con la app debe verse tal cual asi mira la imagen debe ser identico a eso en realida debe ser la misma app»

## Current State Analysis

Hechos leídos (no supuestos):

- **El ejecutable.** `MarketerBrowserLite.exe`, `PE32 executable for MS Windows (GUI), Intel i386 Mono/.Net assembly`, SHA-256 `0c8d2c489aa22776f8e3ac5ab8cd8e70ef39ad22f4bce4f343e322a219d7994f`, .NET Framework 4.7.2 (`MarketerBrowserLite.exe.config`).
- **Está protegido con DNGuard HVM.** Su cadena `Load DNGuard Runtime library failed, runtime library not found or Access Denied.` aparece en el binario, junto a `HVMRuntm.dll` y `HVMRun64.dll`. Solo hay 290 cadenas legibles: el código está virtualizado. Un hilo de WineHQ (solo vi el fragmento de la búsqueda; la página dio 403) sugiere que "solo funcionará con .NET nativo, si es que funciona". **Eso es evidencia débil, no una prueba.**
- **Carpeta de la app** (`win-native/`, 64 archivos fuera de datos): DLL de .NET, `x86/` y `x64/` con DLL nativas, `Update.exe`, `cm.zip`. Los datos viven **junto al ejecutable**: `Data/` (con `0/` y `Theme.style`), `Backups/`, `BackupTemp/`, `Logs/`.
- **Descarga oficial**: `https://www.marketerbrowser.com/Doc/MarketerBrowserLite.zip`, HTTP 200, 28.056.686 bytes, `Last-Modified: 12 Nov 2024`. Tu `.exe` local es de julio de 2024: **la descarga puede ser una versión más nueva**.
- **Laboratorio en Kali WSL 2** (ya preparado): Wine `10.0~repack-11` con `wine32`, Xvfb, x11vnc, `novnc 1.6.0` (`/usr/share/novnc/` con `vnc.html`, `vnc_lite.html`, `core/`), websockify `0.13.0`, openbox, xdotool, wmctrl, ImageMagick, `winetricks 20260125` en `~/work/tools/`. Copia desechable de la app **sin datos** en `~/work/mbl-win` (SHA-256 verificado). Prefijo de Wine en `~/work/wineprefix-mbl`: `winetricks corefonts dotnet48` **terminó con código 0** (9 min), con muchos mensajes `err:ole:` típicos de ese instalador. **Que .NET funcione de verdad bajo Wine solo se sabrá al abrir la app en T0.**
- **Debian trixie** ofrece `wine 10.0~repack-6` y `wine32`; `winetricks` está en `contrib`, así que se fija el script oficial en lugar de instalar el paquete.
- **Repositorio**: `LMiguelGJ/MarketerBrowserLinux`, público, `main` en `06d182a`. `linux-native/` contiene la **reimplementación**, que no es lo que querés.
- **Desconocido**: cómo obtiene la app el Chrome de cada perfil. No hay rutas legibles (código virtualizado). Los iconos `chrome_16`, `chromium_16`, `chrome_mobile_16` y `gray_chrome_16` sugieren varios tipos de núcleo. Se determina probando, no leyendo.

## Proposed Changes

Arquitectura:

```text
Pestaña web (página propia sobre noVNC/rfb.js, a pantalla completa)
      │  WebSocket + token
      ▼
websockify :6080  ──►  x11vnc :5900 (solo localhost)  ──►  Xvfb :99
                                                              │
                                              openbox (sin marco, maximizada)
                                                              │
                                              wine ▸ MarketerBrowserLite.exe (prefijo 32 bits + .NET 4.8)
                                              Data / Backups / Logs  ──►  volumen /data
```

### T0 — Prueba de viabilidad (puerta G1)

- **What**: terminar el prefijo de Wine y abrir el `.exe` de la copia desechable en `:99`; capturar pantalla, ventanas (`wmctrl -l`) y log.
- **How**: `mbl-run-app.sh` (ya escrito en el temporal). Si `dotnet48` falla, **un** reintento con un prefijo nuevo y `dotnet472`; luego, y solo luego, una prueba con Wine-Mono para dejar constancia.
- **Éxito**: se ve la ventana principal con la barra lateral (Profiles, Help, Upgrade, Contact Us) y la tabla.
- **Si no abre → PARO** (G1) y te explico qué se vio. No hay salto de protección.

### T1 — Pantalla que muestra solo la app

- **Files**: `linux-native/docker/openbox-rc.xml`, `linux-native/docker/start-display.sh`.
- **What/How**: Xvfb a `SCREEN` (por defecto `1600x900x24`); openbox con regla para `MarketerBrowserLite.exe`: maximizada y **sin decoración**; fondo negro; sin barra de tareas.
- **Hipótesis a verificar en T0**: la barra de título de tu captura (icono, texto "MarketerBrowserLite v1.0.0.1", minimizar/maximizar/cerrar) parece dibujada por la propia app (controles AntdUI). Si es así, sin marco del gestor de ventanas se ve idéntica. **Si fuese el marco de Windows, el marco será el de openbox y habrá una diferencia visible** que te informaré.

### T2 — La pestaña web, con acceso protegido

- **Files**: `linux-native/docker/web/index.html`, `linux-native/docker/web/app.js`, `linux-native/docker/tokens.tpl`.
- **What/How**: página propia que importa `core/rfb.js` de noVNC: pide la clave, abre el WebSocket, escala el canvas al viewport y no muestra ninguna barra de noVNC. x11vnc escucha **solo en 127.0.0.1**; `websockify --token-plugin TokenFile` solo conecta si la URL del socket lleva el token; el token sale de la variable `MBL_ACCESS_TOKEN`, que es **obligatoria** (el contenedor no arranca sin ella).
- **Límite conocido**: el token viaja en la URL del WebSocket, así que puede quedar en logs del proxy. Se documenta y se recomienda TLS (Dokploy/Traefik).

### T3 — Los navegadores de los perfiles (puerta G2)

- **What/How**: con la app abierta, crear un perfil de prueba, iniciarlo y observar: ¿de dónde sale el navegador?, ¿abre bajo Wine?, ¿aparece en la misma pestaña? Probar con `--no-sandbox` solo si hace falta.
- **Éxito**: un perfil abre y renderiza una página.
- **Si falla → G2**: se entrega igualmente la app abierta (S1 a S3) y te informo qué núcleo falló, sin ocultarlo.

### T4 — Imagen Docker

- **Files**: `linux-native/Dockerfile`, `linux-native/docker/entrypoint.sh`, `linux-native/.dockerignore`, `linux-native/compose.yaml`.
- **How**: `debian:trixie-slim` + `dpkg --add-architecture i386` + `wine wine32 wine64 xvfb x11vnc novnc websockify openbox cabextract`; usuario no-root (UID 1001); `winetricks` fijado a `20260125`; prefijo y `.NET` creados **durante el build**. El ZIP fijado viaja en el contexto de build; un stage privado `app-archive` verifica el SHA-256 del ZIP y el del `MarketerBrowserLite.exe` extraído, y extrae a `/opt/mbl-app` más `/opt/mbl-dist/Data`. La imagen final copia solo lo extraído: el archivo no queda en las capas. Un hash incorrecto falla el build antes de publicar la imagen.
- **Datos**: `Data`, `Backups`, `BackupTemp` y `Logs` se enlazan a ubicaciones persistentes en el volumen `/data`. Ese volumen debe ser **nombrado**: Dokploy solo reenvía `type=volume` a las Applications (los bind mounts se descartan) y un volumen anónimo se pierde al recrear el contenedor.
- **Entrypoint**: valida `MBL_ACCESS_TOKEN`; arranca Xvfb, openbox, x11vnc, websockify y la app; si cualquiera cae, el contenedor sale con error para que Docker lo reinicie.
- **Advertencia**: `Update.exe` puede intentar actualizar la app; en el contenedor los cambios son efímeros.

### T5 — Pruebas de extremo a extremo

- **Files**: `linux-native/scripts/smoke-test.sh`, `linux-native/tests/e2e-novnc.mjs`.
- **How**: levantar el contenedor; comprobar que el WebSocket **sin token es rechazado** y **con token se acepta**; con Playwright abrir la página, introducir la clave, esperar el canvas, **capturar** y hacer clic en "Create Profile" para comprobar que la app responde a través del navegador. Yo reviso la captura contra la tuya.
- **Persistencia**: crear un dato, reiniciar el contenedor y comprobar que sigue en `/data`.

### T6 — Repositorio y documentación

- **How**: rama `feat/wine-novnc` desde `main`. **Etiqueta `reimplementation-v1`** sobre `06d182a` para conservar la reimplementación. En la rama se retira del árbol (sigue en la etiqueta y en el historial). `README.md` nuevo con la guía de Dokploy: Build Path `/linux-native`, `Dockerfile`, contexto `.`, puerto `6080`, variable `MBL_ACCESS_TOKEN`, volumen `/data`, `shm_size` ampliado y dominio con HTTPS. `.gitignore` sigue excluyendo `win-native/` y binarios.
- **Push**: solo de la **rama**; **el merge a `main` queda para vos**, porque Dokploy despliega desde ahí.

## Specs (criterios de aceptación)

- **S1** Se ejecuta el `.exe` **original** bajo Wine, no una reimplementación; la ventana principal se renderiza.
- **S2** Una pestaña muestra **solo** esa ventana (sin escritorio, sin barra de tareas), ocupa todo el viewport y acepta ratón y teclado.
- **S3** La captura coincide con la tuya: título `MarketerBrowserLite v1.0.0.1`, barra lateral y botones de la barra superior. *Revisión visual mía; no es una comparación de píxeles.*
- **S4** La imagen se construye y arranca; ningún binario de Windows suelto ni dato del usuario está en git (el ZIP fijado es la excepción deliberada, verificado por hash en build).
- **S5** Los datos persisten en `/data` tras reiniciar.
- **S6** Sin `MBL_ACCESS_TOKEN` el contenedor no arranca; sin token válido el WebSocket se rechaza; el puerto VNC **no** se publica.
- **S7** La guía de Dokploy es ejecutable tal cual.

## Assumptions & Decisions

Decisiones por defecto, todas editables por vos antes de aprobar:

1. **ODD en modo yolo.** Al ejecutar creo `odd/tasks/app-wine-novnc.md` (specs textuales, tareas, log) con su espejo en Engram, el `todo` visible, **un commit por tarea** en la rama y verificación al cerrar cada una. Avanzo sin pedirte permiso por tarea.
2. **Las únicas pausas son estas puertas:** **G1** la app no abre bajo Wine; **G2** Chrome no funciona bajo Wine; **G3** cualquier necesidad de alterar la protección o la licencia; **G4** escribir fuera de `~/work`, del repo o tocar tu `win-native/Data` real; **G5** merge a `main` o despliegue.
3. **No se elude DNGuard HVM ni ninguna comprobación de licencia.** Si la app se niega a correr bajo Wine, se informa y se decide. Una alternativa posible, que **no ejecuto sin tu decisión**, sería correr un Windows real dentro de una VM/KVM, mucho más pesada.
4. **El ZIP fijado sí entra al repositorio** (decisión del usuario, repositorio público): sin el archivo en el checkout, Dokploy no puede construir una imagen con la app. El stage privado verifica los hashes en build, la imagen final no guarda el archivo, y `win-native/` con los datos del usuario sigue excluido. El build nuevo que sirve hoy el vendor (44 MB) no arranca bajo Wine, así que el archivo fijado es la vía known-good.
5. **Versión**: lo que se descarga puede ser más nuevo que tu `.exe`. Registro ambos SHA-256. Si hay diferencia visible, te la muestro.
6. **Directorio**: el contenido nuevo vive en `linux-native/` para no romper el Build Path que te indiqué; la reimplementación queda en la etiqueta.
7. **La documentación REA publicada** (`evidence-ledger.md` y `feature-matrix.md`) desaparece de `HEAD` pero **sigue en el historial público**; quitarla del historial exigiría reescribirlo y **no está en este plan**.
8. **Revisión independiente obligatoria** al final (`gentle-ai-verify`), porque toca autenticación y entrega con Docker.
9. **Términos de uso**: no sé si la licencia permite servir la app a terceros. Para uso tuyo no cambia nada.

## Verification

- [ ] T0: captura real de la ventana principal bajo Wine y `wmctrl -l` mostrando la ventana.
- [ ] T3: un perfil de prueba abre y renderiza una página (o G2 documentado).
- [ ] T4: `docker build` termina con código 0 con el ZIP en el contexto; el stage privado rechaza un hash incorrecto; el contenedor sin `MBL_ACCESS_TOKEN` **falla**; el hash del EXE instalado coincide con el fijado; los enlaces de `Data`/`Backups`/`Logs` apuntan al volumen; HTTP 200 y health `healthy`.
- [ ] T5: WebSocket sin token rechazado y con token aceptado; captura del canvas desde Playwright; clic en "Create Profile" produce respuesta de la app; reinicio conserva datos.
- [ ] `git ls-files` sin `*.exe`, `*.dll` ni nada de `win-native/`; el único ZIP versionado es el fijado.
- [ ] Informe del verificador independiente sin defectos reales abiertos.
- **Mutación** en lo crítico: quitar el chequeo de token y comprobar que la prueba de rechazo **falla**.

## Out of Scope

- Modificar, desempacar o saltar la protección del `.exe`.
- Reimplementar funciones de la app.
- Ejecutar nada contra tu `Data/`, `Backups/` o `Logs/` reales.
- Reescribir el historial público de git.
- Multiusuario, balanceo o varias instancias por contenedor.
- Merge a `main` y despliegue en Dokploy (decisión tuya).

## Riesgos abiertos, en orden de gravedad

1. **La app puede no arrancar bajo Wine** (DNGuard HVM + WinForms con controles propios). T0 lo resuelve antes de invertir en lo demás.
2. **Chrome bajo Wine en un contenedor** puede ser inestable o lento; origen del navegador desconocido hasta probar.
3. **Latencia y nitidez**: es video de pantalla, no se sentirá como la app local.
4. **Imagen pesada y build largo** por `.NET 4.8` dentro de Wine; el builder de Dokploy recomienda 4 GB de RAM y 2 CPU.
5. **El token en la URL del WebSocket** puede quedar en logs de proxy.
