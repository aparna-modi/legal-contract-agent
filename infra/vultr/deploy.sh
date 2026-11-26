#!/usr/bin/env bash
# ==============================================================================
# Legal Contract Agent — Build, Deploy & Verify on Vultr
# ==============================================================================
# Usage:
#   bash infra/vultr/deploy.sh              # git pull + build + deploy + verify
#   bash infra/vultr/deploy.sh --no-pull    # skip git pull (first deploy or local edits)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${APP_DIR}/.env.vultr"
COMPOSE_FILE="${APP_DIR}/docker-compose.vultr.yml"
SKIP_PULL="false"

for arg in "$@"; do
  case "$arg" in
    --no-pull) SKIP_PULL="true" ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found. Copy .env.vultr.example to .env.vultr and fill in your secrets first."
  exit 1
fi

chmod 600 "$ENV_FILE"

if [ "$SKIP_PULL" != "true" ]; then
  echo "==> [1/5] Pulling latest code from git..."
  git pull --ff-only
else
  echo "==> [1/5] Skipping git pull (--no-pull)."
fi

echo "==> [2/5] Validating ${ENV_FILE}..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

fail_env() {
  echo "ERROR in .env.vultr: $1"
  exit 1
}

[ -n "${APP_DOMAIN:-}" ] || fail_env "APP_DOMAIN is empty."
[[ "$APP_DOMAIN" == *"replace-with"* ]] && fail_env "Replace placeholder APP_DOMAIN with your domain or <ip-with-dashes>.sslip.io."
[ -n "${ACME_EMAIL:-}" ] || fail_env "ACME_EMAIL is empty."
[[ "$ACME_EMAIL" == "you@example.com" ]] && fail_env "Replace placeholder ACME_EMAIL with your real email address."
[ -n "${MONGODB_URI:-}" ] || fail_env "MONGODB_URI is empty."
[[ "$MONGODB_URI" == *"<username>"* ]] && fail_env "Replace placeholder MONGODB_URI with your real MongoDB connection string."
[ -n "${JWT_SECRET:-}" ] || fail_env "JWT_SECRET is empty."
[ "${#JWT_SECRET}" -ge 32 ] || fail_env "JWT_SECRET must be at least 32 characters in production."
[[ "$JWT_SECRET" == *"replace_with"* ]] && fail_env "Replace placeholder JWT_SECRET."
[ -n "${INTERNAL_API_KEY:-}" ] || fail_env "INTERNAL_API_KEY is empty."
[[ "$INTERNAL_API_KEY" == *"replace_with"* ]] && fail_env "Replace placeholder INTERNAL_API_KEY."

PROFILE_ARGS=()
if [ "${VECTOR_STORE_PROVIDER:-qdrant}" = "qdrant" ] && [[ "${QDRANT_URL:-}" == "http://qdrant:6333"* ]]; then
  echo "    Detected self-hosted Qdrant configuration -> enabling profile selfhosted-qdrant."
  PROFILE_ARGS+=(--profile selfhosted-qdrant)
fi
if [ "${ENABLE_SELFHOSTED_MONGO:-false}" = "true" ]; then
  echo "    Detected ENABLE_SELFHOSTED_MONGO=true -> enabling profile selfhosted-mongo."
  PROFILE_ARGS+=(--profile selfhosted-mongo)
fi

echo "==> [3/5] Building & starting Docker Compose stack..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${PROFILE_ARGS[@]}" up -d --build --remove-orphans

echo "==> [4/5] Waiting for HTTPS edge, backend readiness, and AI service health..."
BASE_URL="https://${APP_DOMAIN}"
READY="false"
for i in $(seq 1 30); do
  if curl -fsS --max-time 8 "${BASE_URL}/health/ready" >/tmp/lca_health_ready.json 2>/dev/null; then
    READY="true"
    break
  fi
  echo "    Waiting for TLS certificate & /health/ready (${i}/30)..."
  sleep 4
done

echo "==> [5/5] Running post-deploy verification checks..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${PROFILE_ARGS[@]}" ps

if [ "$READY" != "true" ]; then
  echo "WARNING: ${BASE_URL}/health/ready did not return 200 within 120s."
  echo "Inspect logs with:"
  echo "  docker compose -f docker-compose.vultr.yml --env-file .env.vultr logs --tail=100 caddy backend-1 ai-service"
  exit 1
fi

echo "    /health/ready -> $(cat /tmp/lca_health_ready.json)"
rm -f /tmp/lca_health_ready.json

LB_STATUS="$(curl -fsS --max-time 8 "${BASE_URL}/lb-health" || true)"
echo "    /lb-health    -> ${LB_STATUS}"

METRICS_CODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "${BASE_URL}/metrics" || echo "000")"
echo "    /metrics (unauth, expected 401) -> HTTP ${METRICS_CODE}"
if [ "$METRICS_CODE" != "401" ]; then
  echo "WARNING: Expected /metrics without X-Internal-Service-Key to return 401, got ${METRICS_CODE}!"
fi

AI_READY="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T ai-service \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())" || true)"
echo "    ai-service internal /health/ready -> ${AI_READY}"

# Reclaim space from previous builds
docker image prune -f >/dev/null 2>&1 || true

echo ""
echo "================================================================================"
echo "Deployment SUCCESSFUL! App is live at: ${BASE_URL}"
echo "================================================================================"
