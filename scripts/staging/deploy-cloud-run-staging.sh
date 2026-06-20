#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [ ! -f .env.staging ]; then
  echo "ERROR: .env.staging not found." >&2
  exit 1
fi

set -a
source .env.staging
set +a
source scripts/staging/guard-staging.sh

secret_vars=(
  FIREBASE_CLIENT_EMAIL_SECRET FIREBASE_PRIVATE_KEY_SECRET
  MERCADOPAGO_ACCESS_TOKEN_SECRET MERCADOPAGO_CLIENT_ID_SECRET
  MERCADOPAGO_CLIENT_SECRET_SECRET MERCADOPAGO_TOKEN_ENCRYPTION_KEY_SECRET
  MERCADOPAGO_WEBHOOK_SECRET_SECRET
)
for name in "${secret_vars[@]}"; do
  if [ -z "${!name:-}" ] || [[ "${!name}" == *"CHANGE_ME"* ]]; then
    echo "ERROR: missing secret name $name" >&2
    exit 1
  fi
  if [[ "${!name}" != revendasmart-staging-* ]]; then
    echo "ERROR: secret $name must use the revendasmart-staging- prefix" >&2
    exit 1
  fi
done

gcloud run deploy "$STAGING_SERVICE" \
  --source . \
  --project "$STAGING_PROJECT_ID" \
  --region "$STAGING_REGION" \
  --service-account "$STAGING_RUNTIME_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 300s \
  --set-env-vars "NODE_ENV=staging,PORT=8080,FIREBASE_PROJECT_ID=$STAGING_PROJECT_ID,FRONTEND_URL=$STAGING_FRONTEND_URL,APP_BASE_URL=$STAGING_BACKEND_URL,MERCADOPAGO_REDIRECT_URI=$STAGING_BACKEND_URL/api/mercadopago/callback,PREMIUM_PRICE_BRL=${PREMIUM_PRICE_BRL:-19.90},ALLOW_UNSIGNED_SUBSCRIPTION_WEBHOOK=false" \
  --set-secrets "FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL_SECRET}:latest,FIREBASE_PRIVATE_KEY=${FIREBASE_PRIVATE_KEY_SECRET}:latest,MERCADOPAGO_ACCESS_TOKEN=${MERCADOPAGO_ACCESS_TOKEN_SECRET}:latest,MERCADOPAGO_CLIENT_ID=${MERCADOPAGO_CLIENT_ID_SECRET}:latest,MERCADOPAGO_CLIENT_SECRET=${MERCADOPAGO_CLIENT_SECRET_SECRET}:latest,MERCADOPAGO_TOKEN_ENCRYPTION_KEY=${MERCADOPAGO_TOKEN_ENCRYPTION_KEY_SECRET}:latest,MERCADOPAGO_WEBHOOK_SECRET=${MERCADOPAGO_WEBHOOK_SECRET_SECRET}:latest"
