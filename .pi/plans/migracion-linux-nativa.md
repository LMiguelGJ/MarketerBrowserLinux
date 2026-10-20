# Plan: migración Linux nativa con interfaz web

> Creado con plan-mode-trae. Estado: **aprobado y aplicado**. Cortes 0 a 4 ejecutados en Kali WSL 2.
> Resultado verificado: 31 pruebas unitarias/integración, 4 pruebas E2E con Chromium real y
> `scripts/test-docker.sh` con resultado `PASS: docker runtime verified`.
> Desviaciones y pendientes actuales: `linux-native/docs/feature-matrix.md`.
> Ubicación del plan: `.pi/plans/migracion-linux-nativa.md` (raíz del repositorio).

## Summary

Reconstruir las capacidades necesarias de MarketerBrowserLite como una aplicación Linux con interfaz web, navegador nativo y distribución Docker. Usar REA para obtener especificaciones verificables del original y Kali WSL 2 para pruebas, sin convertir el EXE, usar Wine ni prometer paridad no demostrada.

La entrega se divide en cortes: primero demostrar un flujo vertical Linux; después incorporar capacidades mediante una matriz de equivalencia. Aprobar este plan no demuestra que toda la funcionalidad propietaria sea recuperable.

## Current State Analysis

### Exploración realizada

- `MarketerBrowserLite.exe.config`: declara .NET Framework 4.7.2 y redirecciones de dependencias.
- `MarketerBrowserLite.exe`: inspección REA previa identifica CIL AnyCPU, referencias WinForms/System.Drawing y 37 declaraciones P/Invoke; no es una entrada recompilable con Emscripten.
- `BrowserController.dll`: metadatos e imports estáticos muestran contratos de cookies/proxy y control Win32 de ventanas, teclado y mouse.
- `ChromeController.dll`: metadatos y llamadas estáticas muestran control de procesos, comandos de navegador, archivos y servidor TCP local.
- `Languages/lang.inf`: contenido `EN`; no ofrece por sí mismo catálogo de traducciones ni requisitos funcionales.
- `x64/`: contiene `SQLite.Interop.dll`, `Curl.dll`, `mwfx.dll` y bibliotecas 7z. Su presencia no prueba cuándo se utilizan.
- `BrowserWEB/Dockerfile` (otro proyecto del autor, fuera de este repositorio): referencia explícitamente aportada; Node 22 sobre Debian Bookworm, Camoufox, Xvfb, usuario no-root y entrada `server.js`. No se inspeccionaron `server.js`, `package.json`, cliente ni datos de BrowserWEB.
- El Dockerfile externo cambió entre lecturas: no se considera referencia congelada ni configuración probada. Sus nombres de paquetes deben verificarse antes de reutilizarlos.
- No se encontraron fuentes ni proyectos de compilación en el alcance previamente inspeccionado; se excluyeron datos privados.
- `wsl.exe --list --verbose`: `kali-linux` y `Ubuntu-24.04` registradas en WSL 2, ambas detenidas. No se inició ninguna distribución ni se comprobó Docker, Node o conectividad dentro de ellas.
- `git status --short`: falló con `fatal: not a git repository`; esta carpeta es una distribución sin repositorio Git reconocido. No inicializar Git ni hacer commits en esta fase.

### Evidencia REA retenida

| ID | Objeto y alcance |
| --- | --- |
| E1 `ev_0b4c72bddd22aff48f0f4138767bc7e66b8337b15638c0b032fd93e3c43d7a25` | Identidad y framework del ejecutable. SHA-256 `0c8d2c489aa22776f8e3ac5ab8cd8e70ef39ad22f4bce4f343e322a219d7994f`. |
| E2 `ev_05788fa9efea765fd095660a212672f3f4ccf60396a8baab4f183747b694bd98` | Declaraciones nativas del ejecutable. |
| E3 `ev_c372f934cc2722c144f8e5ce908471eebbe425bcdc1efbefdebb74b307f7e1d7` | Declaraciones Win32 de BrowserController. |
| E4 `ev_eed652522dab97a14435c3f3e8787420722bb8d9efda1b5161fdd82cc5a11370` | Miembros estáticos de BrowserController. |
| E5 `ev_d6256ff3f7d839f4436c67fdf8bec93acae58443ba46fe8ba3f5db98f897074a` | Miembros y llamadas estáticas de ChromeController. |
| E6 `ev_c51d4fc6e2d051260d536b1464e638b57980c1b61d7484275c1f1cb0a98cb864` | Inspección de miembros de FPLib no disponible por presupuesto de representación. |

E1 tiene cobertura parcial por una entrada ManifestResource inválida. E4/E5 tienen cobertura parcial y no prueban ejecución. No repetir productores idénticos: recuperar evidencia retenida; cambiar de técnica solo ante una pregunta concreta y con capacidad disponible. No se abrió una sesión nativa de desensamblador que requiera cierre.

## Proposed Changes

Todos los archivos de implementación indicados abajo son NUEVOS y propuestos, no existentes. La única escritura realizada durante planificación es este documento. Los EXE/DLL y sus datos originales permanecen intactos.

### Arquitectura elegida

```text
Pestaña Windows
    │ HTTP/WebSocket autenticados, acceso inicial solo localhost
    ▼
Servidor Node.js 22 / API y UI web
    ├── Gestor de perfiles y trabajos
    ├── Adaptador Camoufox/Playwright
    ├── Persistencia propia SQLite
    └── Pasarela noVNC/websockify
            ▼
       Xvfb + VNC interno + navegador nativo Linux

Docker Compose → servicios y volúmenes aislados
Kali WSL 2 → entorno de desarrollo y pruebas, no imagen de producción
```

Elección inicial: UI HTML/CSS/JavaScript sencilla servida por Node; evitar introducir un framework frontend para la prueba vertical. Camoufox se utiliza por la referencia aportada, NO por equivalencia demostrada con el Chromium del original. Playwright controla el navegador; noVNC proporciona interacción visual desde la pestaña. Cada navegador interactivo tendrá display/canal de visualización dedicado; no compartir un escritorio entre identidades que deban estar aisladas.

### Corte 0 — derechos, baseline y contrato funcional

**Entradas reales:** `MarketerBrowserLite.exe`, `BrowserController.dll`, `ChromeController.dll`, `FPLib.dll` y sus evidencias REA.

**Archivos propuestos:**
- `linux-native/docs/evidence-ledger.md`: identidades, Evidence IDs, observaciones/inferencias/desconocidos y límites.
- `linux-native/docs/feature-matrix.md`: una fila por función del Lite observado, con entrada, resultado, persistencia, dependencia Windows, reemplazo y prueba.

**Cómo:**
1. Confirmar disponibilidad del fuente y derechos de modificación/reutilización antes de copiar código recuperado. No eludir licencias, activación, protección u ofuscación. Si no hay derechos de reutilización, obtener únicamente especificaciones de comportamiento mediante un proceso independiente permitido; si eso tampoco está permitido, detener esa parte.
2. Reutilizar E1–E6; inspeccionar solamente miembros/recursos adicionales necesarios para preguntas específicas. No inferir requisitos de Lite a partir de funciones publicitadas para ediciones superiores.
3. Obtener baseline del original únicamente con entorno desechable y datos sintéticos. No iniciar el EXE contra los perfiles actuales. La ejecución y el alcance del entorno de prueba deben quedar explícitos antes de iniciarlo.
4. Registrar por separado funciones recuperables, funciones reconstruibles y funciones no establecidas. Los bloqueos de FPLib/HVM se documentan; no se presume haber recuperado algoritmos propietarios.

**Salida:** contrato verificable del primer flujo y lista explícita de diferencias. No prometer compatibilidad exacta de huellas, sesiones ni formatos propietarios.

### Corte 1 — laboratorio Kali WSL 2

**Archivo propuesto:** `linux-native/docs/wsl-testing.md`.

**Cómo:**
1. Tras aprobación, iniciar explícitamente `kali-linux` mediante WSL y comprobar arquitectura, distribución, herramientas instaladas y disponibilidad del motor Docker.
2. Comprobar si Docker Desktop ofrece integración con Kali; si funciona, usarla. Si no existe motor disponible, detener la preparación y presentar una instalación concreta con sus cambios antes de ejecutarla. No instalar un segundo daemon automáticamente.
3. El laboratorio usa únicamente `linux-native/` y volúmenes de prueba nuevos. No copiar `Data/`, `Backups/`, `BackupTemp/`, `Logs/`, claves, cookies o perfiles existentes.
4. Si el montaje de OneDrive presenta problemas de rendimiento, permisos o locks, solicitar un directorio Linux concreto antes de crear/copiar fuera del workspace; la autorización de usar WSL no es permiso general sobre su HOME.
5. Usar la imagen Debian del prototipo como candidato, no Kali como base de producción. Fijar versiones compatibles mediante documentación oficial y un build real; no copiar ciegamente paquetes del Dockerfile de referencia.

**Salida:** registro reproducible de versiones y resultado de preflight. Ausencia de herramientas es un bloqueo, no una prueba aprobada.

### Corte 2 — primer flujo vertical nativo

**Archivos propuestos:**
- `linux-native/package.json`, `package-lock.json`: Node 22, dependencias fijadas y scripts de prueba.
- `linux-native/server.js`: entrada del servicio, salud, autenticación y rutas.
- `linux-native/src/profiles.js`: validación, IDs internos y ciclo de vida.
- `linux-native/src/browser-engine.js`: adaptador Camoufox/Playwright sin imports de DLL Windows.
- `linux-native/src/storage.js`: base SQLite propia para datos nuevos; directorio de navegador separado por perfil.
- `linux-native/src/viewer.js`: resolución autenticada de la sesión visual y encaminamiento interno.
- `linux-native/public/index.html`, `app.js`, `styles.css`: listado, crear/abrir/cerrar perfil y visor interactivo.
- `linux-native/Dockerfile`, `compose.yaml`, `.dockerignore`, `scripts/entrypoint.sh`: runtime Linux no-root y servicios visuales internos.

**Flujo de aceptación:** crear dos perfiles sintéticos → abrir cada navegador → visualizar/controlar cada uno desde una pestaña → navegar a sitio de prueba local → escribir dato/cookie sintéticos → cerrar → reiniciar servicio/contenedor → reabrir y comprobar persistencia y separación.

**Límites:** primera entrega local, un usuario, máximo dos perfiles de prueba simultáneos. No es un límite definitivo del producto. No importar automáticamente perfiles del original.

### Corte 3 — capacidades por equivalencia comprobada

**Archivos propuestos:**
- `linux-native/src/proxy.js`: configuración validada por perfil y credenciales fuera de logs.
- `linux-native/src/cookies.js`: import/export de cookies sintéticas bajo un esquema nuevo validado.
- `linux-native/src/import-export.js`: formato versionado propio; entradas inválidas no cambian estado.
- `linux-native/tests/fixtures/`: datos sintéticos, nunca perfiles reales.

Orden: proxy por perfil → cookies → import/export → opciones restantes demostradas en la matriz. Admitir HTTP/SOCKS únicamente en combinaciones soportadas y probadas por el motor elegido; rechazar explícitamente las no soportadas. No implementar un protocolo por afirmación genérica del proveedor.

Copiar cookies de Chromium a Firefox no garantiza sesión válida. La compatibilidad de perfiles antiguos será un trabajo separado después de documentar el formato y autorizar su lectura; no forma parte de esta primera migración.

No añadir sincronización masiva, emulador Android, analíticas ni automatizaciones de otras ediciones salvo que la matriz y el alcance aprobado demuestren su necesidad.

### Corte 4 — endurecimiento y entrega Docker

**Archivos propuestos:**
- `linux-native/tests/unit/*.test.js`: validación y reglas de estado.
- `linux-native/tests/integration/*.test.js`: API, almacenamiento y motor.
- `linux-native/tests/e2e/*.spec.js`: interfaz y visor con navegadores reales.
- `linux-native/tests/fixtures/site/server.js`: sitio local controlado para pruebas.
- `linux-native/README.md`: arranque, seguridad, backup, restauración y diferencias conocidas.

**Cómo:**
- Exponer solo `127.0.0.1:3000` para la entrega inicial. No publicar VNC, DevTools ni puertos de control directamente.
- Autenticar API y WebSocket/visor; validar origen y proteger acciones de cambio de estado. Usar secreto generado para el laboratorio y cargado por entorno, nunca incrustado ni registrado.
- Ejecutar como no-root; no usar contenedor privilegiado, host networking, montaje del socket Docker ni montaje de directorios del host con perfiles reales.
- Mantener sandbox del navegador cuando sea compatible. Si el entorno lo impide, registrar bloqueo de seguridad en lugar de desactivarlo silenciosamente.
- Datos y perfiles en volúmenes dedicados; límites de recursos y limpieza de procesos/display ante cierres y fallos.
- Build sin secretos ni datos de la distribución original. Descarga de navegador en build, no en cada arranque.
- Revisión independiente obligatoria de aislamiento, autenticación, persistencia y ciclo de vida después de las comprobaciones propias. Native review solo según el switch RDD del usuario; no reemplaza las pruebas funcionales.

## Assumptions & Decisions

- Decisión explícita del usuario en Phase 2: **«Versión Linux nativa con interfaz web»**. Wine, emulación Windows y WebAssembly quedan fuera.
- REA sirve para establecer contratos, no para prometer conversión ni fuente recuperado. Una reimplementación equivalente puede diferir internamente del original.
- La primera entrega verificable es el flujo vertical de dos perfiles; la matriz mantiene pendiente toda función no verificada. No se declara migración completa con solo una pantalla o un health check.
- La UI nueva no necesita replicar los píxeles ni los controles de WinForms; sí los comportamientos aprobados por función.
- BrowserWEB se usa solo como referencia del Dockerfile ya autorizado. Leer o modificar el resto requiere autorización explícita sobre el directorio de BrowserWEB; el plan no depende de copiar su código.
- Los módulos y archivos listados bajo `linux-native/` son diseños propuestos, no rutas descubiertas ni implementaciones existentes.
- No se fijan porcentajes de código recuperable, plazos o consumo de RAM sin medición.
- El directorio actual no es Git. Antes de implementar, acordar una ubicación/repositorio de trabajo; no incluir ejecutables o datos privados en Git. No hacer commits sin autorización explícita.
- Derechos de reutilización y disponibilidad de fuente siguen sin confirmarse; son gates para las acciones afectadas, no hechos asumidos.
- Un resultado bloqueado en un corte se registra y se presenta para decisión; no cambiar motor ni sustituir Linux nativo por Wine automáticamente.

## Verification

### Comprobaciones hechas durante planificación

- [x] WSL inventariado: Kali y Ubuntu en WSL 2, detenidas.
- [x] Evidencia REA retenida localizada, sin repetir el análisis ni ejecutar el target.
- [x] Configuración del original y Dockerfile de referencia leídos; límites documentados.
- [x] Ausencia de Git detectada: comando fallido, no prueba aprobada.
- [ ] Herramientas de Kali, Docker y navegación real: NO comprobadas.
- [ ] Build Linux, pruebas funcionales y seguridad: NO ejecutados.

### Comandos propuestos para después de aprobar

Preflight explícito, sin instalaciones:

```text
wsl.exe -d kali-linux -- uname -m
wsl.exe -d kali-linux -- sh -lc 'command -v docker; command -v node; command -v npm'
wsl.exe -d kali-linux -- docker version
wsl.exe -d kali-linux -- docker compose version
```

Desde el directorio Linux resuelto y validado de `linux-native/`, después de implementar los scripts:

```text
npm run test:unit
npm run test:integration
npm run test:e2e
docker compose config --quiet
docker compose build
docker compose up -d
npm run test:docker
```

Estos scripts todavía NO existen. Sus contratos serán: unitarias con Node test runner; integración con directorios temporales nuevos; E2E con Playwright; prueba Docker con espera de salud acotada y salida no cero ante fallo. Builds y suites de duración desconocida se lanzan en segundo plano; sin reintentos automáticos ante timeout. La limpieza afecta solo recursos de laboratorio identificados, nunca volúmenes preexistentes.

### Criterios de aceptación

- [ ] UI abre desde Windows en `http://localhost:3000` y permite interacción real por visor.
- [ ] Perfiles A y B conservan datos independientes; tras reiniciar, cada uno recupera solo los suyos.
- [ ] Apertura/cierre repetidos no dejan procesos ni displays huérfanos.
- [ ] Proxy se comprueba mediante destino controlado; errores y combinaciones no soportadas son visibles y no corrompen el perfil.
- [ ] Importación válida conserva campos y versión; importación inválida deja registros, archivos y contadores sin cambios.
- [ ] Solicitudes API/visor sin autorización son rechazadas; un ID de perfil no permite recorrer directorios ni conectar a destinos internos arbitrarios.
- [ ] El build final no contiene EXE/DLL Windows, secretos, cookies o datos del usuario.
- [ ] Las pruebas capturan salida, errores y exit code; no confundir declaraciones estáticas, tests simulados y comportamiento real.
- [ ] Cada función acordada figura como equivalente verificada, diferencia aceptada o bloqueo explícito. No cerrar «todo migrado» con filas pendientes.
- [ ] Resultado revisado independientemente por tratar autenticación, aislamiento y persistencia.

## Out of Scope

- Implementar o instalar durante esta planificación.
- Acceder a perfiles, bases de datos o credenciales reales; migraciones destructivas.
- Saltar protección, licencias o activación; copiar código sin derechos establecidos.
- Garantizar huella idéntica, indetectabilidad o conservación de sesiones entre motores.
- Publicar el servicio en Internet, multiusuario, despliegue cloud o TLS público; requieren un corte de seguridad posterior.
- Modificar BrowserWEB o instalar/reconfigurar Docker/WSL sin un alcance aprobado.

## Estado de aprobación

Phase 1 completada con archivos de configuración, referencia externa autorizada y evidencia estática retenida. Phase 2 resuelta para la ruta técnica; derechos y gates operativos están explicitados. Phase 3: este documento. Phase 4: **aprobado por el usuario y aplicado con autorización de ejecución autónoma**.

Resultado de la ejecución: los cuatro cortes quedaron implementados y verificados. La distribución Windows original no se modificó, no se copió código propietario y no se accedió a `Data/`, `Backups/`, `BackupTemp/` ni `Logs/`.

Desviación documentada: el visor usa un canal WebSocket propio en lugar de noVNC/websockify sobre Xvfb, con el motivo y el compromiso explicados en `linux-native/docs/feature-matrix.md`.

Al continuar: releer este archivo y `linux-native/docs/feature-matrix.md`, que enumera las funciones parciales y pendientes antes de ampliar el alcance.
