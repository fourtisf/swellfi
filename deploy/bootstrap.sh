#!/usr/bin/env bash
# One-shot setup of Swellfi on a fresh Ubuntu 24.04 VPS. Run as root; safe to re-run.
#
#   curl -fsSL https://raw.githubusercontent.com/fourtisf/swellfi/main/deploy/bootstrap.sh -o bootstrap.sh
#   EMAIL=you@example.com bash bootstrap.sh
#
# Optional variables:
#   EMAIL     Let's Encrypt account e-mail (expiry notices). Recommended.
#   BUILDER   Builder fee address (NEXT_PUBLIC_BUILDER_ADDRESS). Trading is blocked until it's set.
#   ADMIN     Comma-separated admin master-wallet addresses (ADMIN_ADDRESSES).
#   BRANCH    Git branch to deploy (default: main).
#
# What it does: installs Node 22, pnpm, PM2, Postgres, Redis, Nginx and certbot; creates the
# `swellfi` system user that runs the app; clones the repo to /srv/swellfi; writes a production
# .env with fresh secrets (never overwritten on re-runs); builds; starts both apps under PM2 with
# boot persistence; gets a Let's Encrypt certificate; enables the firewall (SSH, 80, 443).
set -euo pipefail
trap 'echo "bootstrap failed at line $LINENO: $BASH_COMMAND (exit $?)" >&2' ERR

DOMAIN="swellfi.xyz"
REPO="https://github.com/fourtisf/swellfi.git"
BRANCH="${BRANCH:-main}"
APP_USER="swellfi"
APP_DIR="/srv/swellfi"
PNPM_VERSION="10.28.0"
EMAIL="${EMAIL:-}"
BUILDER="${BUILDER:-}"
ADMIN="${ADMIN:-}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
as_app() { sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

step "System packages"
apt-get update -y
apt-get install -y ca-certificates curl git gnupg openssl ufw postgresql redis-server nginx certbot

step "Node.js 22"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
# pnpm as a plain global install: corepack keeps a per-user cache and can fail silently for
# the app user, so its shims are removed first.
command -v corepack >/dev/null && corepack disable pnpm pnpx >/dev/null 2>&1 || true
[ "$(pnpm -v 2>/dev/null || true)" = "$PNPM_VERSION" ] || npm install -g --force "pnpm@${PNPM_VERSION}"
command -v pm2 >/dev/null || npm install -g pm2
echo "pnpm $(pnpm -v), pm2 $(pm2 -v 2>/dev/null | tail -1)"

step "Swap (the Next.js build needs memory)"
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3500 ] && [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "added 2G swap (RAM ${mem_mb} MB)"
else
  echo "RAM ${mem_mb} MB, swap devices: $(swapon --show --noheadings | awk 'END{print NR}')"
fi

step "App user and code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" && chown "$APP_USER:$APP_USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  as_app "git fetch origin '$BRANCH' && git checkout '$BRANCH' && git pull --ff-only origin '$BRANCH'"
else
  sudo -u "$APP_USER" -H git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
as_app "pnpm -v >/dev/null"

step "Postgres and Redis"
systemctl enable --now postgresql redis-server
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo ".env exists: keeping its secrets"
else
  DB_PASS=$(openssl rand -hex 24)
  if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'")" = 1 ]; then
    sudo -u postgres psql -qc "ALTER ROLE $APP_USER WITH PASSWORD '$DB_PASS';"
  else
    sudo -u postgres psql -qc "CREATE ROLE $APP_USER WITH LOGIN PASSWORD '$DB_PASS';"
  fi
  [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$APP_USER'")" = 1 ] \
    || sudo -u postgres psql -qc "CREATE DATABASE $APP_USER OWNER $APP_USER;"

  # Invite codes in the repo are public, so production gets its own.
  CODES="SWELL-$(openssl rand -hex 6 | tr a-f A-F),SWELL-$(openssl rand -hex 6 | tr a-f A-F),SWELL-$(openssl rand -hex 6 | tr a-f A-F)"

  step "Production .env"
  sed \
    -e "s|^APP_URL=.*|APP_URL=https://${DOMAIN}|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" \
    -e "s|^NEXT_PUBLIC_HL_NETWORK=.*|NEXT_PUBLIC_HL_NETWORK=testnet|" \
    -e "s|^NEXT_PUBLIC_BUILDER_ADDRESS=.*|NEXT_PUBLIC_BUILDER_ADDRESS=${BUILDER}|" \
    -e "s|^ADMIN_ADDRESSES=.*|ADMIN_ADDRESSES=${ADMIN}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${APP_USER}:${DB_PASS}@localhost:5432/${APP_USER}?schema=public|" \
    -e "s|^SEED_DEMO=.*|SEED_DEMO=false|" \
    -e "s|^SEED_INVITE_CODES=.*|SEED_INVITE_CODES=${CODES}|" \
    "$APP_DIR/.env.example" > "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
  echo "wrote $ENV_FILE (invite codes: $CODES)"
fi

step "Install, migrate, build"
as_app "pnpm install --frozen-lockfile"
as_app "pnpm db:generate && pnpm db:deploy && pnpm db:seed"
as_app "pnpm build"

step "Start under PM2"
if as_app "pm2 describe swellfi-api" >/dev/null 2>&1; then
  as_app "pm2 reload deploy/ecosystem.config.cjs --update-env"
else
  as_app "pm2 start deploy/ecosystem.config.cjs"
fi
as_app "pm2 save"
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null
systemctl enable "pm2-$APP_USER" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/api/health && echo
curl -fsS -o /dev/null -w "web: HTTP %{http_code}\n" http://127.0.0.1:3000/

step "Nginx and HTTPS"
mkdir -p /var/www/certbot
rm -f /etc/nginx/sites-enabled/default
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ ! -f "$CERT" ]; then
  my_ip=$(curl -fsS -4 https://api.ipify.org || true)
  for h in "$DOMAIN" "www.$DOMAIN"; do
    got=$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')
    [ "$got" = "$my_ip" ] || warn "$h resolves to '${got:-nothing}', this server is '$my_ip'. Fix DNS if certbot fails."
  done
  # Temporary HTTP-only site so Let's Encrypt can reach the challenge directory.
  cat > /etc/nginx/sites-available/swellfi <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host \$host; }
}
NGINX
  ln -sf /etc/nginx/sites-available/swellfi /etc/nginx/sites-enabled/swellfi
  nginx -t && systemctl reload nginx
  if [ -n "$EMAIL" ]; then acct=(-m "$EMAIL"); else acct=(--register-unsafely-without-email); fi
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos "${acct[@]}" --deploy-hook "systemctl reload nginx"
fi
cp "$APP_DIR/deploy/nginx/swellfi.conf" /etc/nginx/sites-available/swellfi
ln -sf /etc/nginx/sites-available/swellfi /etc/nginx/sites-enabled/swellfi
nginx -t && systemctl reload nginx

step "Firewall"
ssh_port=$( (sshd -T 2>/dev/null || true) | awk '/^port /{p=$2} END{print p}')
ufw allow "${ssh_port:-22}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,8p'

step "Check"
curl -fsS -o /dev/null -w "https://${DOMAIN}: HTTP %{http_code}\n" "https://${DOMAIN}/" || warn "HTTPS check failed (DNS still propagating?)"
curl -fsS "https://${DOMAIN}/api/health" && echo || true

cat <<DONE

Swellfi is live at https://${DOMAIN}
  App code   ${APP_DIR}  (user: ${APP_USER})
  Config     ${ENV_FILE}  (chmod 600)
  Invites    grep SEED_INVITE_CODES ${ENV_FILE}
  Logs       sudo -u ${APP_USER} pm2 logs
  Update     sudo -u ${APP_USER} -H bash -lc 'cd ${APP_DIR} && ./deploy/deploy.sh'
DONE
grep -q '^NEXT_PUBLIC_BUILDER_ADDRESS=$' "$ENV_FILE" && warn "NEXT_PUBLIC_BUILDER_ADDRESS is empty: orders are blocked. Set it in .env, then run the update command."
grep -q '^ADMIN_ADDRESSES=$' "$ENV_FILE" && warn "ADMIN_ADDRESSES is empty: nobody can approve the waitlist yet."
exit 0
