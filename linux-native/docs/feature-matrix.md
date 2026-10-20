# Matriz funcional — equivalencia Linux

Una fila por función observada en el original (evidence-ledger.md) o requerida por el
flujo de aceptación.

Estados:

- `verificada` — implementada y con una prueba que observa el efecto en la interfaz pública.
- `parcial` — implementada, pero con una parte sin probar o con alcance menor que el original.
- `pendiente` — no implementada en esta entrega.
- `fuera-de-alcance` — pertenece a ediciones superiores o a un contrato propietario.
- `no-established` — no se pudo establecer el comportamiento de referencia.

Regla aplicada: una fila solo llega a `verificada` cuando existe una prueba que observa el
efecto. Nada se marcó como equivalente por analogía de nombre. La columna de prueba cita el
archivo real que la cubre.

| ID | Función | Origen | Evidencia | Dependencia Windows | Reemplazo Linux | Prueba | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | Crear perfil | `BrowserController`/`ChromeController` | E4, E5 | Ninguna directa | `POST /api/profiles`, nombre validado, directorio propio por perfil | `tests/integration/api.test.js` | verificada |
| F02 | Listar perfiles y estado | idem | E4, E5 | Ninguna | `GET /api/profiles` con estado `stopped`/`running` | `tests/integration/api.test.js` | verificada |
| F03 | Abrir perfil (navegador real) | `ChromeController.Chrome` (`BrowserProcess`) | E5 | Lanzar proceso Windows | Contexto persistente de Playwright, directorio de datos por perfil | `tests/integration/engine.test.js`, `tests/e2e/viewer.spec.js` | verificada |
| F04 | Cerrar perfil | `CustomFuncBase.CloseBrowser`, `KillProcessTree` | E3, E5 | Terminar árbol de procesos | Cierre del contexto del navegador; el perfil puede reabrirse y eliminarse en ejecución sin dejar sesión en el motor | `tests/integration/engine.test.js`, `tests/integration/regression.test.js` (C6), `tests/e2e/viewer.spec.js`, `tests/e2e/lifecycle.spec.js` | verificada |
| F05 | Ver y controlar el navegador | `GetChromeWindowImage`, `ActiveBrowser`, `SetForegroundWindow` | E3, E5 | Captura de ventana y foco de Windows | Canal WebSocket por perfil: fotogramas PNG y reenvío de entrada (clic, tecla, scroll) | `tests/integration/viewer.test.js` | parcial |
| F06 | Cargar URL | `LoadUrlCommand` | E4 | Ninguna | `POST /api/profiles/:id/navigate`, solo `http(s)` | `tests/integration/api.test.js`, `tests/e2e/viewer.spec.js` | verificada |
| F07 | Ejecutar JavaScript en la página | `JsCommand`, `ExecuteJsCommand`, `JsResult` | E4 | Ninguna | `POST /api/profiles/:id/evaluate` sobre el contexto | `tests/e2e/viewer.spec.js` | verificada |
| F08 | Cerrar pestaña | `CloseTabCommand` | E4 | Ninguna | `POST /api/profiles/:id/close-tab`; el perfil sigue utilizable tras cerrar la última pestaña | `tests/integration/regression.test.js` (C8), `tests/e2e/lifecycle.spec.js` | verificada |
| F09 | Listar frames | `GetAllFramesCommand` | E4 | Ninguna | `GET /api/profiles/:id/frames` | `tests/integration/engine.test.js`, `tests/e2e/viewer.spec.js` | verificada |
| F10 | Cookies: escribir, listar, borrar | `CookieCommand`, `SetCookie`, `GetCookie`, `GetAllCookie`, `ClearCookies` | E4, E5 | Ninguna | Almacenamiento por perfil y restauración en el contexto al abrir; el reemplazo es atómico y rechaza duplicados | `tests/integration/api.test.js`, `tests/integration/regression.test.js` (C3), `tests/e2e/viewer.spec.js` | verificada |
| F11 | Proxy por perfil | `SetProxyCommand`, `SetProxy` | E4, E5 | Ninguna directa | Proxy del contexto del navegador; credenciales fuera de logs y respuestas | `tests/integration/viewer.test.js` | parcial |
| F12 | Puerto de red del navegador | `SetNetworkingPortCommand` | E4 | Ninguna | Puerto de depuración local, no expuesto fuera del servicio | — | pendiente |
| F13 | Ajustes de contenido | `SetContentSettingsCommand`, `ContentSettingsType` | E4 | Ninguna | Requiere conocer el tipo y valor exactos del original | — | pendiente |
| F14 | Almacenamiento del navegador | `StorageCommand` | E4 | Ninguna | `POST /api/profiles/:id/storage` sobre `localStorage` y `sessionStorage` | `tests/integration/engine.test.js`, `tests/e2e/viewer.spec.js` | verificada |
| F15 | Imagen de la página | `ImageCommand`, `GetChromeWindowImage` | E4, E5 | Captura GDI de Windows | `GET /api/profiles/:id/screenshot` devuelve PNG | `tests/integration/engine.test.js`, `tests/e2e/viewer.spec.js` | verificada |
| F16 | Reiniciar URLs de pestañas | `ResetTabUrlsCommand` | E4 | Ninguna | `POST /api/profiles/:id/reset-urls` | `tests/integration/engine.test.js`, `tests/e2e/lifecycle.spec.js` | verificada |
| F17 | Descarga de archivos | `DownloadFileHelper`, `DownloadFileForm`, `WebDownloadFile` | E5 | Diálogo de descargas WinForms | El motor gestiona la descarga; falta exponerla y su carpeta por perfil | — | pendiente |
| F18 | Importar y exportar perfiles/datos | Import/Export de la edición Lite | web oficial | Formato propietario desconocido | Formato propio versionado; la importación es transaccional y no deja perfiles a medias | `tests/integration/api.test.js`, `tests/integration/regression.test.js` (C4) | verificada |
| F19 | Sincronización de acciones entre ventanas (Master Control) | Anuncio de edición Full | web oficial | Automatización de teclado/mouse de Windows | — | — | fuera-de-alcance |
| F20 | Analíticas y emulador Android | Anuncio de edición Full | web oficial | Multiples | — | — | fuera-de-alcance |
| F21 | Licencia y runtime propietario | `CheckRuntime`/`CheckRuntime64` (HVM) | E2 | Runtime Windows propietario | No se reproduce ni se elude; el diseño Linux no lo requiere | — | no-established |
| F22 | Generación de huellas propias | `FPLib`, `mwfx.dll` | E6, E7 | Algoritmo propietario no disponible | Se usan las capacidades del motor Linux elegido | — | no-established |
| F23 | Formato de perfiles existentes | Estructura de `Data/` | — | Formato propietario | No se importa en esta entrega | — | no-established |
| F24 | Detección de ejemplos de tareas | `CustomFuncBase`, `FilterConditionInfo`, `MatchType`, `SpecialKey` | E4 | Automatización de escritorio | Se difiere hasta validar el flujo vertical | — | pendiente |
| F25 | Detección de proxy e IP | `IPChecker.exe`, `SocketProxy.dll` | E7, E8 | Sockets Windows | El motor expone la IP efectiva del contexto | — | pendiente |

Leyenda de dependencias: E7 = fronteras nativas de `FPLib.dll`; E8 = referencias del ensamblado principal.

## Por qué F05 y F11 son parciales

- **F05 (visor).** El canal está implementado y probado: entrega fotogramas y reenvía
  entrada al perfil. Lo que **no** está probado es el clic de ratón nativo dentro del
  navegador real: la entrada viaja como coordenada y la prueba usa el driver simulado. El
  flujo de imágenes y de teclas está verificado; el clic real sobre la página, no.
- **F11 (proxy).** La validación, el formato y el cableado hacia el motor están verificados
  con el driver simulado. **No** se probó contra un servidor proxy real, porque el
  laboratorio no incluye uno. La comprobación pendiente es que el navegador salga por el
  proxy y no por la ruta directa.

## Flujo de aceptación del corte vertical

Estado: **cumplido** con las pruebas citadas arriba.

1. Crear perfil A y perfil B con datos sintéticos — `api.test.js`.
2. Abrir ambos; cada uno con su propio directorio — `api.test.js`, `engine.test.js`.
3. Ver el navegador desde el canal del visor — `viewer.test.js`.
4. Navegar a un sitio local de prueba y escribir un valor — `e2e/viewer.spec.js`.
5. Cerrar y reabrir sin conflicto, y eliminar un perfil en ejecución sin dejar sesión en el
   motor — `engine.test.js`, `e2e/lifecycle.spec.js`. **No se observa directamente** la
   ausencia de procesos de Chromium huérfanos en el sistema operativo: queda como
   comprobación pendiente.
6. Reabrir y comprobar que cada perfil conserva solo lo suyo — `e2e/viewer.spec.js`.
7. Confirmar que un identificador de perfil no permite recorrer el sistema de archivos —
   `regression.test.js` (D1): rutas con `..`, `%2e%2e` y barras codificadas responden 400 o
   404, y el motor se niega a resolver o borrar fuera de su directorio de perfiles. El
   servicio escucha en `127.0.0.1` por defecto (`regression.test.js`, S5).

## Hallazgos de la verificación independiente

Un verificador de solo lectura encontró defectos reales que las pruebas iniciales no veían.
Cada uno tiene ahora una prueba de regresión en `tests/integration/regression.test.js`.
Para C1, C3, C5 y C7 se comprobó por mutación (quitando el arreglo en la copia de Kali)
que la prueba **falla** sin él; en el resto, la prueba se apoya en su aserción y no se
mutó, así que su sensibilidad al defecto no está demostrada del mismo modo.

| ID | Defecto | Arreglo | Prueba |
| --- | --- | --- | --- |
| C1 | Un `RST` del cliente en el upgrade mataba el proceso sin autenticar | Handler `error` en el socket antes de cualquier rama | C1 (mutación: falla) |
| C2 | `decodeURIComponent` sin protección en el upgrade | `decodeProfileId` valida y devuelve 400 | C2 |
| C3 | `replaceCookies` no era atómico | Transacción y rechazo previo de duplicados | C3 (mutación: falla) |
| C4 | Importación con duplicados dejaba un perfil a medias | `importProfile` transaccional | C4 |
| C5 | Dos `open` concurrentes lanzaban dos navegadores | Guarda por perfil durante la apertura | C5 (mutación: falla) |
| C6 | `DELETE` durante un `open` dejaba una sesión huérfana | `close` espera la apertura en curso | C6 |
| C7 | `DELETE` no borraba el directorio del navegador | `removeProfileData` con comprobación de raíz | C7 (mutación: falla) |
| C8 | `close-tab` dejaba el perfil inutilizable | Página activa seguida por el driver | C8, E2E real |
| C9 | Estado `running` obsoleto tras un reinicio | Se reinicia al abrir el almacenamiento | C9 |
| C10 | JSON `null` o `%` mal formado daba 500 | Validación del cuerpo y del id | C10 |
| C11 | Perfil inexistente devolvía 200 vacío | `requireProfile` en cada ruta | C11 |
| S1 | Cookie de sesión sin `Secure` | `MBL_SECURE_COOKIES=true` la marca | S1 |
| S2 | Sin comprobación de `Origin` | 403 si el origen no coincide con el host, también en el upgrade | S2 |
| S3 | `--no-sandbox` fijo | `MBL_BROWSER_SANDBOX`; activo por defecto, desactivado de forma explícita en la imagen | E2E con sandbox activo |
| S4 | `python3`, `make`, `g++` en la imagen | Eliminados del Dockerfile | — (revisión del Dockerfile; ninguna prueba lo comprueba) |
| S5 | Autenticación desactivable en una interfaz pública | El arranque se niega | S5 |

## Desviación documentada respecto del plan

El plan proponía un visor basado en **noVNC/websockify sobre Xvfb**. La implementación usa un
**canal WebSocket propio** que entrega fotogramas PNG del navegador y reenvía la entrada.

Motivos: cada perfil ya tiene su propio contexto de navegador aislado, así que el escritorio
compartido de Xvfb no aporta aislamiento y multiplica los procesos; el canal propio evita
un demonio adicional y mantiene un único camino de autenticación. El compromiso es menor
fluidez que un escritorio remoto y ausencia de cursor nativo del sistema.

## Diferencias aceptadas y comunicables

- La huella digital es la del motor Linux elegido, no la del original.
- Las cookies de Chromium no se transfieren de forma utilizable entre motores.
- No hay inyección de teclado ni de ratón a nivel de sistema operativo.
- La sincronización de acciones entre ventanas, las analíticas y el emulador Android
  pertenecen a ediciones superiores.
- El formato de exportación es propio y no compatible con el formato privado del original.
- El servicio se publica solo en `127.0.0.1`; exponerlo requiere una revisión de
  seguridad posterior.
