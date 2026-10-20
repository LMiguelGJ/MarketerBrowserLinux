# Registro de evidencia — migración Linux nativa

Fuente: distribución local `MarketerBrowserLite` (carpeta `win-native/`, excluida del repositorio). Los SHA-256 identifican de forma inequívoca los binarios analizados, aunque cambie su ubicación.
Método: análisis estático con REA (`inspect_managed_artifact`, `inspect_managed_native_boundaries`,
`inspect_managed_members`). No se ejecutó el binario, no se inspeccionaron perfiles, cookies, bases de datos
ni credenciales, y no se copió código propietario.

## Identidades de los artefactos

| Artefacto | SHA-256 | Evidencia REA |
| --- | --- | --- |
| `MarketerBrowserLite.exe` | `0c8d2c489aa22776f8e3ac5ab8cd8e70ef39ad22f4bce4f343e322a219d7994f` | E1, E2 |
| `BrowserController.dll` | `ccd83272439d55cee1dd31c530586aa44c469a6731bad3d838b4ca69b773c824` | E3, E4 |
| `ChromeController.dll` | `90c05721d3abd0d087f04d27ac6790c61d4ce9f5e8b1fc45d77cf47a60bcf75e` | E5 |
| `FPLib.dll` | `d79d62a6dd0191524d89a9f90abecbd9acce76a37086614cfefaec735df48050` | E6 |

## Evidence IDs

| ID | Operación | Alcance observado |
| --- | --- | --- |
| E1 | `inspect_managed_artifact` | Ensamblado CIL AnyCPU, `MarketerBrowserLite` 1.0.0.1, MVID `374c0316-91e9-4878-b430-664b5bfd2584`, target `.NETFramework,Version=v4.7.2`. 29 referencias de ensamblado, 66 recursos incrustados, 307 tipos, 9577 métodos. |
| E2 | `inspect_managed_native_boundaries` | 8 ModuleRefs (`user32.dll`, `user32`, `User32.dll`, `Kernel32.dll`, `WinInet.dll`, `gdi32.dll`, `HVMRuntm.dll`, `HVMRun64.dll`) y 37 declaraciones P/Invoke. |
| E3 | `inspect_managed_native_boundaries` | `BrowserController.dll`: 2 ModuleRefs y 20 declaraciones `user32` de control de ventanas, teclado y mouse. |
| E4 | `inspect_managed_members` | 47 tipos, 290 métodos, 389 aristas de llamada. Comandos de navegador: cookies, proxy, carga de URL, cierre de pestaña, contenido, settings, storage, JS, imágenes, puertos de red, frames. |
| E5 | `inspect_managed_members` | 33 tipos, 275 métodos, 2544 aristas. Proceso de navegador, cookies, proxy, imagen de ventana, DevTools listener, descargas, `LocalListener`, `Tcpserver`. |
| E6 | `inspect_managed_members` | **No disponible**: los metadatos exceden el presupuesto de representación de 64 MiB. Sin análisis de miembros. |

## Observaciones (hechos leídos del artefacto)

- **O1** El ejecutable es código administrado de .NET Framework 4.7.2, AnyCPU, con implementaciones en CIL
  y sin firma ReadyToRun ni cabecera nativa mixta (E1, E2). No es una entrada recompilable por Emscripten.
- **O2** El ejecutable referencia `System.Windows.Forms` y `System.Drawing` (E1). La interfaz es WinForms.
- **O3** El ejecutable declara 37 importaciones nativas (E2), entre ellas `SetForegroundWindow`, `SetParent`,
  `SetWindowPos`, `EnumWindows`, `SetCursorPos`, `mouse_event`, `keybd_event`, `DeleteUrlCacheEntry`.
- **O4** `BrowserController.dll` declara 20 importaciones `user32` (E3): `FindWindowEx`, `EnumChildWindows`,
  `GetWindowTextW`, `SetCursorPos`, `keybd_event`, `SetForegroundWindow`, `ShowWindow`, `GetWindowRect`,
  `IsIconic`, entre otras.
- **O5** `ChromeController.dll` no declara P/Invoke (E5), pero expone `BrowserProcess`, `SetCookie`,
  `GetCookie`, `GetAllCookie`, `ClearCookies`, `SetProxy`, `GetChromeWindowImage`, `ActiveBrowser`,
  `StartDevToolsListener`, `CheckChromeDriver` y un `Tcpserver`/`LocalListener` con `StartListen`.
- **O6** `BrowserController.dll` modela comandos de navegador como tipos (`LoadUrlCommand`, `CookieCommand`,
  `SetProxyCommand`, `CloseTabCommand`, `JsCommand`, `StorageCommand`, `SetNetworkingPortCommand`,
  `SetContentSettingsCommand`, `GetAllFramesCommand`, `ResetTabUrlsCommand`, `ExecuteJsCommand`,
  `ImageCommand`) con `CommandState`/`ResultState`/`JsResult` (E4).
- **O7** `FPLib.dll` declara `user32` (`GetWindowLong`, `SetWindowLong`), `kernel32` (`SetDllDirectory`) y
  bibliotecas no estándar `mwfx.dll` (`WriteFile_`) y `Curl.dll` (`GetVerify`) (E6 parcial: sí disponible
  en la operación de fronteras nativas).
- **O8** El ejecutable declara `HVMRuntm.dll`/`HVMRun64.dll` con `VMRuntime.CheckRuntime` y
  `CheckRuntime64` (E2): dependencia de un runtime propietario no presente como fuente.
- **O9** `MarketerBrowserLite.exe.config` declara `supportedRuntime` v4.0 / .NETFramework v4.7.2 y
  redirecciones de binding para `Newtonsoft.Json` 13.0.0.0, `SharpCompress`, `System.Memory`,
  `NPOI.OOXML`, `System.Text.Encoding.CodePages` y otros.
- **O10** `Languages/lang.inf` contiene únicamente `EN`. No hay catálogo de traducciones ni requisitos
  funcionales ahí.
- **O11** `x64/` contiene `SQLite.Interop.dll`, `Curl.dll`, `mwfx.dll` y librerías 7z. Su presencia no
  prueba en qué flujo se usan.

## Inferencias (derivadas, no observadas)

- **I1** La gestión de perfiles, cookies y proxy está implementada en C# y la integración con ventanas,
  teclado y mouse de Windows ocurre en la capa nativa declarada (O3, O4, O5). En Linux el sustituto
  natural es la extensión de proxy y cookies del navegador elegido, no una reimplementación de Win32.
- **I2** El control de ventanas del sistema solo es necesario para la sincronización tipo "Master Control"
  y para automatización de escritorio; un motor Linux por perfil no lo necesita si la interacción se
  realiza por canal de control del navegador o por escritorio virtual.
- **I3** `CheckRuntime` de HVM sugiere comprobación de licencia/entorno en tiempo de ejecución. No se
  reproduce ni se elude; el diseño Linux no lo incluye y esa diferencia queda documentada.

## Desconocidos (no establecidos)

- **U1** Estructura y semántica exactas del formato de perfil, cookies y exportación: no se inspeccionó
  `Data/`, `Backups/` ni `BackupTemp/` por contener datos del usuario.
- **U2** Algoritmo de generación de huellas: reside en `FPLib`/`mwfx.dll`, cuyo análisis de miembros no
  está disponible y cuyo código no es reutilizable sin derechos.
- **U3** Funciones realmente usadas por el usuario: la presencia de un método no indica uso.
- **U4** Comportamiento de `mwfx.dll` y `Curl.dll`: binarios nativos no analizados con proveedor nativo.
- **U5** Equivalencia de sesiones entre el Chromium del original y el motor Linux elegido: no verificable
  sin pruebas con perfiles reales, fuera del alcance acordado.

## Decisiones de derechos

- No se copió código del original, ni binario, ni decompilado, ni pseudoreconstruido.
- El diseño Linux se define por comportamiento observable y por contratos públicos del motor elegido.
- La reimplementación es independiente: puede diferir internamente del original y no reproduce su
  licencia, activación ni footprint de huella digital.

## Límites del análisis

- E1 tiene cobertura parcial: la fila `ManifestResource 0x28000042` es inválida.
- E4 y E5 tienen cobertura parcial y describen código estático; no prueban ejecución en tiempo de ejecución.
- E6 no está disponible por límite de representación; no se reintentó con el mismo productor.
- No se abrió ninguna sesión nativa de desensamblador que requiera cierre.
