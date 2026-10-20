#!/usr/bin/env bash
# Verificación del runtime Docker: build, arranque, salud, flujo de API y
# apagado limpio. Falla con código distinto de cero ante cualquier problema.
set -euo pipefail

PROJECT="mbl-verify-$$"
CONTAINER="mbl-verify-container-$$"
IMAGE="mbl-linux-native:verify"
TOKEN="verify-token-$$"
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "${PROJECT}-data" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

echo "==> Building image"
docker build -t "$IMAGE" "$WORKDIR"

echo "==> Running container"
docker volume create "${PROJECT}-data" >/dev/null
# Same restrictions as compose.yaml, so the test exercises the hardened runtime.
docker run -d --name "$CONTAINER" \
  -p 127.0.0.1:0:3000 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -e MBL_AUTH_TOKEN="$TOKEN" \
  -e MBL_MAX_PROFILES=2 \
  -v "${PROJECT}-data:/data" \
  "$IMAGE" >/dev/null

echo "==> Checking the service runs as a non-root user"
uid="$(docker exec "$CONTAINER" id -u)"
[ "$uid" = "1001" ] || { echo "FAIL: expected uid 1001, got $uid" >&2; exit 1; }

echo "==> Checking the runtime image has no compiler toolchain"
if docker exec "$CONTAINER" sh -c 'command -v g++ || command -v make || command -v python3' >/dev/null 2>&1; then
  echo "FAIL: build tools are present in the runtime image" >&2
  exit 1
fi

echo "==> Waiting for health"
for _ in $(seq 1 60); do
  # `docker port` fails while the container has not published the port yet;
  # with `set -o pipefail` that failure would abort the script, so the
  # pipeline is explicitly allowed to fail here.
  port="$(docker port "$CONTAINER" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://' || true)"
  if [ -n "$port" ] && curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

port="$(docker port "$CONTAINER" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://' || true)"
if [ -z "$port" ]; then
  echo "FAIL: the container never published a port" >&2
  docker logs "$CONTAINER" >&2 || true
  exit 1
fi

echo "==> Health check on port $port"
curl -sf "http://127.0.0.1:${port}/api/health" | grep -q '"status":"ok"' \
  || { echo "FAIL: health endpoint did not answer ok" >&2; exit 1; }

echo "==> Rejecting unauthenticated request"
status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/profiles")"
[ "$status" = "401" ] || { echo "FAIL: expected 401, got $status" >&2; exit 1; }

echo "==> Creating a profile"
created="$(curl -sf -X POST "http://127.0.0.1:${port}/api/profiles" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"name":"docker verify"}')"
echo "$created" | grep -q '"docker verify"' \
  || { echo "FAIL: profile was not created" >&2; exit 1; }

echo "==> Listing profiles"
count="$(curl -sf "http://127.0.0.1:${port}/api/profiles" -H "authorization: Bearer ${TOKEN}" \
  | grep -o '"id"' | wc -l | tr -d ' ')"
[ "$count" = "1" ] || { echo "FAIL: expected 1 profile, got $count" >&2; exit 1; }

echo "==> Verifying the data volume persisted the profile"
docker exec "$CONTAINER" node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/mbl.sqlite');const rows=db.prepare('SELECT name FROM profiles').all();if(rows.length!==1||rows[0].name!=='docker verify'){console.error('FAIL: volume content unexpected',rows);process.exit(1)}"

echo "==> Restarting and re-checking persistence"
docker restart "$CONTAINER" >/dev/null
# `docker restart` re-publishes the port: with a random host port the mapping
# changes, so it must be read again instead of reusing the previous value.
for _ in $(seq 1 60); do
  port="$(docker port "$CONTAINER" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://' || true)"
  if [ -n "$port" ] && curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if [ -z "$port" ]; then
  echo "FAIL: the container did not publish a port after the restart" >&2
  docker logs "$CONTAINER" >&2 || true
  exit 1
fi
count="$(curl -sf "http://127.0.0.1:${port}/api/profiles" -H "authorization: Bearer ${TOKEN}" \
  | grep -o '"id"' | wc -l | tr -d ' ')"
[ "$count" = "1" ] || { echo "FAIL: profile did not survive the restart (got $count)" >&2; exit 1; }

echo "==> Checking the image contains no Windows binaries from the original distribution"
# Un paquete npm puede traer utilidades de otra plataforma (por ejemplo
# playwright-core/bin/PrintDeps.exe); lo que no debe aparecer son los binarios
# de la distribución original ni ejecutables de Windows fuera de node_modules.
if docker run --rm --entrypoint sh "$IMAGE" -c "find / -iname 'MarketerBrowserLite*' -o -iname 'BrowserController*' -o -iname 'ChromeController*' -o -iname 'FPLib*' | grep -q ."; then
  echo "FAIL: files from the original distribution found in the image" >&2
  exit 1
fi
if docker run --rm --entrypoint sh "$IMAGE" -c "find /app -path /app/node_modules -prune -o \\( -iname '*.exe' -o -iname '*.dll' \\) -print | grep -q ."; then
  echo "FAIL: Windows binaries found outside node_modules" >&2
  exit 1
fi

echo "==> Stopping the container"
docker stop "$CONTAINER" >/dev/null
remaining="$(docker ps -a --filter "name=${CONTAINER}" --filter status=running -q | wc -l | tr -d ' ')"
[ "$remaining" = "0" ] || { echo "FAIL: container still running" >&2; exit 1; }

echo "PASS: docker runtime verified"
