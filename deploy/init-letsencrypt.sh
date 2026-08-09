#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# First-time TLS issuance. Run ONCE, before the first deploy.
# Renewals afterwards are automatic (the certbot service in docker-compose.yml).
#
#   ./deploy/init-letsencrypt.sh [--staging]
#
# There is a bootstrap deadlock to break here: nginx will not start without a
# certificate file, and certbot cannot get a certificate without nginx serving
# the ACME challenge. So we plant a throwaway self-signed cert, start nginx on
# it, get the real one, and reload.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERROR: .env not found. Copy .env.example to .env and fill it in." >&2; exit 1; }
set -a; . ./.env; set +a

: "${DOMAIN:?DOMAIN must be set in .env}"
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL must be set in .env}"

STAGING_ARG=""
if [ "${1:-}" = "--staging" ]; then
  # Let's Encrypt rate-limits failed issuance hard (5 failures per account per
  # hostname per hour). Dry-run against staging first if DNS is at all in doubt.
  STAGING_ARG="--staging"
  echo "==> STAGING mode: the resulting certificate will NOT be trusted by browsers."
fi

CERT_PATH="/etc/letsencrypt/live/$DOMAIN"

echo "==> Domain: $DOMAIN (and www.$DOMAIN)"
echo "==> Both must already have DNS A records pointing at this machine."
echo "    Issuance fails otherwise, and repeated failures burn the hourly quota."
read -r -p "    DNS is in place? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || { echo "Aborted."; exit 1; }

echo "==> Planting a temporary self-signed certificate so nginx can start"
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p '$CERT_PATH' &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout '$CERT_PATH/privkey.pem' \
    -out '$CERT_PATH/fullchain.pem' \
    -subj '/CN=$DOMAIN'
"

echo "==> Starting nginx on the placeholder certificate"
docker compose up -d nginx
sleep 5

echo "==> Removing the placeholder so certbot does not treat it as existing"
docker compose run --rm --entrypoint sh certbot -c "rm -rf '$CERT_PATH' /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"

echo "==> Requesting the real certificate"
docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  $STAGING_ARG \
  --email "$CERTBOT_EMAIL" \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --rsa-key-size 2048 \
  --agree-tos \
  --no-eff-email \
  --non-interactive

echo "==> Reloading nginx onto the real certificate"
docker compose exec nginx nginx -s reload

echo
echo "Done. Verify:  curl -I https://$DOMAIN"
echo "Then deploy the app:  ./deploy/deploy.sh"
