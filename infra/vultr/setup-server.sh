#!/usr/bin/env bash
# ==============================================================================
# Legal Contract Agent — One-Time Vultr Ubuntu 24.04 VPS Setup Script
# ==============================================================================
# Run on a fresh Vultr Ubuntu 24.04 LTS instance (2 vCPU / 4 GB RAM recommended):
#   curl -fsSL https://raw.githubusercontent.com/aparna-modi/legal-contract-agent/main/infra/vultr/setup-server.sh | sudo bash
# Or after cloning:
#   sudo bash infra/vultr/setup-server.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/aparna-modi/legal-contract-agent.git}"
APP_DIR="${APP_DIR:-/opt/legal-contract-agent}"
BRANCH="${BRANCH:-main}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run this script as root or with sudo: sudo bash $0"
  exit 1
fi

echo "==> [1/6] Updating system packages & installing base tools..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw openssl jq

echo "==> [2/6] Installing Docker Engine & Docker Compose plugin..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if [ -n "${SUDO_USER:-}" ] && id "$SUDO_USER" >/dev/null 2>&1; then
  usermod -aG docker "$SUDO_USER"
fi

echo "==> [3/6] Configuring 2 GB swap (safety margin for Docker builds)..."
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness=' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

echo "==> [4/6] Configuring UFW firewall (allowing only SSH 22, HTTP 80, HTTPS 443)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> [5/6] Cloning / updating repository at ${APP_DIR}..."
if [ -d "${APP_DIR}/.git" ]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  mkdir -p "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

chmod +x "${APP_DIR}/infra/vultr/deploy.sh" "${APP_DIR}/infra/vultr/setup-server.sh"

echo "==> [6/6] Preparing .env.vultr template..."
PUBLIC_IP="$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
SSLIP_DOMAIN="$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"

if [ ! -f "${APP_DIR}/.env.vultr" ]; then
  cp "${APP_DIR}/.env.vultr.example" "${APP_DIR}/.env.vultr"
  chmod 600 "${APP_DIR}/.env.vultr"
  GEN_INTERNAL_KEY="$(openssl rand -hex 32)"
  sed -i "s|^APP_DOMAIN=.*|APP_DOMAIN=${SSLIP_DOMAIN}|" "${APP_DIR}/.env.vultr"
  sed -i "s|^INTERNAL_API_KEY=.*|INTERNAL_API_KEY=${GEN_INTERNAL_KEY}|" "${APP_DIR}/.env.vultr"
fi

if [ -n "${SUDO_USER:-}" ] && id "$SUDO_USER" >/dev/null 2>&1; then
  chown -R "${SUDO_USER}:${SUDO_USER}" "$APP_DIR"
fi

cat <<EOF

================================================================================
Vultr Server Bootstrap Complete!
================================================================================
Detected Public IPv4 : ${PUBLIC_IP}
Instant HTTPS Domain : ${SSLIP_DOMAIN} (pre-filled in .env.vultr; replace with your custom domain if you have one)

NEXT STEPS:
  1. Whitelist ${PUBLIC_IP} in MongoDB Atlas -> Network Access.
  2. Edit ${APP_DIR}/.env.vultr and paste your real values from Render:
       nano ${APP_DIR}/.env.vultr
     Required keys:
       - APP_DOMAIN       (keep ${SSLIP_DOMAIN} or set your custom domain)
       - ACME_EMAIL       (your real email for Let's Encrypt HTTPS)
       - MONGODB_URI      (from Render)
       - JWT_SECRET       (from Render, min 32 chars)
       - GEMINI_API_KEY   (from Render)
       - QDRANT_URL / QDRANT_API_KEY (from Render, or set VECTOR_STORE_PROVIDER=chroma)
  3. Deploy the entire stack (Frontend + Backend x2 + AI Service + Redis + HTTPS):
       cd ${APP_DIR} && bash infra/vultr/deploy.sh --no-pull
================================================================================
EOF
