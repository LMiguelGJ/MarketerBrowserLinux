# MBL Linux Native

Interfaz web en Linux para gestionar perfiles de navegador aislados, con motor de
navegador real y entrega en Docker.

Es una **reimplementación independiente** de las capacidades observadas en
MarketerBrowser Lite, no una conversión del binario original. No comparte código,
licencia, activación ni footprint de huella digital con el producto de origen.
Las diferencias están documentadas en `docs/feature-matrix.md`.

## Qué resuelve

- Perfiles de navegador con datos aislados: cada perfil tiene su propio
  directorio, cookies y almacenamiento.
- Control desde una pestaña del navegador: visor con capturas en vivo y envío de
  entrada (clics, teclas, scroll) al perfil.
- Proxy por perfil (HTTP/HTTPS/SOCKS4/SOCKS5), con credenciales fuera de los logs.
- Cookies por perfil, con importación y exportación en un formato propio versionado.
- Auditoría de acciones por perfil.

## Arquitectura

```text
Pestaña (HTTP + WebSocket)
    │  autenticado por token Bearer
    ▼
Servidor Node.js 22
    ├── perfiles y estado        (SQLite)
    ├── motor de navegador       (Playwright, un contexto persistente por perfil)
    ├── visor                    (WebSocket: fotogramas PNG + entrada)
    └── proxy / cookies / import-export
            ▼
       Chromium nativo en Linux
```

Docker empaqueta el conjunto; cada navegador corre dentro del contenedor, sin
necesidad de un servidor X11 en el host.

## Requisitos

- Node.js 22 o superior (el prototipo se validó con Node 24.19).
- Un navegador para Playwright: `npx playwright install chromium`.
- Docker, solo para la entrega empaquetada.

## Arranque local

```bash
npm install
export MBL_AUTH_TOKEN="$(openssl rand -hex 24)"
npm start
```

La UI queda en `http://127.0.0.1:3000`. Se pega el token en la barra superior.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `MBL_AUTH_TOKEN` | *(vacío)* | Token Bearer. Sin él y con `MBL_REQUIRE_AUTH=true` el servicio rechaza todo. |
| `MBL_HOST` | `127.0.0.1` | Interfaz de escucha. |
| `MBL_PORT` | `3000` | Puerto. |
| `MBL_DATA_DIR` | `./data` | Base SQLite, perfiles y estado. |
| `MBL_MAX_PROFILES` | `2` | Tope del **total** de perfiles guardados, estén abiertos o no. |
| `MBL_ENGINE` | `chromium` | `chromium`, `firefox` o `webkit`. Un valor desconocido se rechaza. |
| `MBL_HEADLESS` | `true` | `false` para ver el navegador nativo. |
| `MBL_REQUIRE_AUTH` | `true` | Con `false` el servicio queda abierto. El arranque se niega si además `MBL_HOST` no es una interfaz local (`127.0.0.1`, `localhost`, `::1`). |
| `MBL_BROWSER_SANDBOX` | `true` | Sandbox de Chromium. La imagen Docker lo desactiva de forma explícita porque el contenedor no tiene capacidades. |
| `MBL_SECURE_COOKIES` | `false` | Marca la cookie de sesión como `Secure`. Actívalo solo si el servicio se sirve por HTTPS. |

## Docker

```bash
export MBL_AUTH_TOKEN="$(openssl rand -hex 24)"
docker compose up -d
```

El servicio se publica solo en `127.0.0.1:3000`. El token es obligatorio: compose
falla si no está definido.

```bash
docker compose logs -f      # logs
docker compose down          # parar
docker compose down -v       # parar y borrar el volumen de datos
```

## Pruebas

```bash
npm run test:unit          # validación pura, sin dependencias externas
npm run test:integration   # API, estado, ciclo de vida y regresiones, con driver simulado
npm run test:e2e           # navegador real (requiere el binario de Chromium)
npm run test:docker        # build, arranque, salud y persistencia en contenedor
```

Las suites E2E se marcan como omitidas, nunca como aprobadas, cuando el binario
del navegador no está instalado.

## API

Todas las rutas `/api/*` salvo `/api/health` exigen autenticación:

- `Authorization: Bearer <token>` en cualquier ruta.
- La cookie de sesión `mbl_session` (`HttpOnly`, `SameSite=Strict`), que el servidor emite
  tras una llamada autenticada con Bearer. Es lo que permite al navegador abrir el visor.
- `?token=<token>` **solo** en el upgrade del WebSocket del visor. En el resto de rutas se
  rechaza, para que el token no quede en logs de proxy ni en el historial.

Las peticiones con una cabecera `Origin` distinta del `Host` se rechazan con `403`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Estado del servicio. |
| `GET` | `/api/profiles` | Lista de perfiles. |
| `POST` | `/api/profiles` | Crea un perfil. Cuerpo: `{ name, proxy? }`. |
| `GET` | `/api/profiles/:id` | Detalle de un perfil. |
| `DELETE` | `/api/profiles/:id` | Cierra el navegador si está abierto y elimina el perfil, sus cookies y sus datos de navegador en disco. |
| `POST` | `/api/profiles/:id/open` | Abre el navegador del perfil. |
| `POST` | `/api/profiles/:id/close` | Cierra el navegador del perfil. |
| `POST` | `/api/profiles/:id/navigate` | Navega. Cuerpo: `{ url }` (http/https). |
| `POST` | `/api/profiles/:id/close-tab` | Cierra la pestaña actual. |
| `GET` | `/api/profiles/:id/frames` | Lista los frames de la página. |
| `GET` | `/api/profiles/:id/screenshot` | Devuelve un PNG de la página. |
| `POST` | `/api/profiles/:id/storage` | Lee o escribe almacenamiento. Cuerpo: `{ area, key?, value? }`. |
| `POST` | `/api/profiles/:id/reset-urls` | Devuelve todas las pestañas a una URL base. |
| `POST` | `/api/profiles/:id/evaluate` | Evalúa JS en la página. Cuerpo: `{ expression }`. |
| `GET` | `/api/profiles/:id/cookies` | Cookies del perfil. |
| `POST` | `/api/profiles/:id/cookies` | Reemplaza las cookies del perfil. |
| `GET` | `/api/profiles/:id/export` | Exporta un bundle versionado. |
| `GET` | `/api/profiles/:id/audit` | Auditoría del perfil. |
| `POST` | `/api/import` | Importa un bundle versionado. |
| `WS` | `/api/profiles/:id/viewer` | Canal del visor: fotogramas PNG y entrada. |

Las entradas inválidas se rechazan con `400` y **no modifican** los datos
almacenados. El reemplazo de cookies y la importación son transaccionales: o se
escribe todo o no se escribe nada. Un perfil inexistente responde `404` en todas
las rutas que lo usan.

## Seguridad

- Escucha en `127.0.0.1` por defecto; el despliegue por defecto no expone nada a
  la red.
- Token comparado con `timingSafeEqual`.
- Comprobación de `Origin` en las llamadas y en el upgrade del visor.
- El sandbox de Chromium está activo por defecto; solo se desactiva por configuración.
- Los perfiles viven bajo `MBL_DATA_DIR`; el identificador de perfil se valida
  antes de tocar el disco, de modo que no permite recorrer rutas.
- Las credenciales de proxy no aparecen en las respuestas de la API ni en los
  logs: la API expone una etiqueta sin usuario ni contraseña.
- El contenedor corre como usuario no-root (UID 1001), con `cap_drop: ALL` y
  `no-new-privileges` (`compose.yaml`). `scripts/test-docker.sh` arranca la imagen con las
  mismas restricciones y comprueba el UID y la ausencia de compiladores.
- Chromium se ejecuta con su sandbox desactivado dentro de la imagen, porque `cap_drop: ALL`
  impide los namespaces de usuario que necesita. Es una concesión consciente: el aislamiento
  lo aporta el contenedor, no el sandbox del navegador.
- La imagen no contiene binarios de Windows ni datos del usuario.

Publicar el servicio fuera de `localhost` requiere una revisión de seguridad
adicional: TLS y límite de peticiones.

## Visor

El visor es un **canal WebSocket propio**, no un escritorio remoto con noVNC.

Cada perfil ya tiene su contexto de navegador aislado, así que un escritorio Xvfb
compartido no aportaría aislamiento y multiplicaría los procesos. El canal propio
evita un demonio adicional y mantiene un único camino de autenticación: la API
entrega una cookie de sesión `HttpOnly` que el navegador reenvía en el upgrade.

El compromiso: menos fluidez que un escritorio remoto y sin cursor nativo del
sistema. La interacción es clic, tecla y scroll sobre la página.

## Diferencias conocidas frente al original

- La huella digital es la del motor Linux elegido, no la del producto original.
- Las cookies de Chromium no se transfieren de forma utilizable: la sesión no
  sobrevive al cambio de motor.
- No hay inyección de teclado ni de ratón a nivel de sistema operativo.
- La sincronización de acciones entre ventanas, las analíticas y el emulador
  Android pertenecen a ediciones superiores y quedan fuera de alcance.
- El formato de exportación es propio y no compatible con el formato privado
  del original.

## Documentación

- `docs/evidence-ledger.md` — evidencia REA, observaciones, inferencias y desconocidos.
- `docs/feature-matrix.md` — equivalencia función por función con su prueba.
- `docs/wsl-testing.md` — laboratorio Kali WSL 2 y preflight.
