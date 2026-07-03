#!/usr/bin/env bash
set -euo pipefail

# RevendaSmart — Cloud Run Secret Manager setup template
# Safe template only. Do not commit real secret values.
# Usage:
#   1. Copy this file locally if needed.
#   2. Fill the variables below in your shell session only.
#   3. Execute commands after reviewing project, service and region.

PROJECT_ID="revenda-smart"
REGION="us-central1"
SERVICE="revendasmart-backend"
SERVICE_ACCOUNT="764966803100-compute@developer.gserviceaccount.com"

# Fill these values locally. Never commit real values.
MERCADOPAGO_ACCESS_TOKEN_VALUE="COLE_AQUI"
MERCADOPAGO_CLIENT_ID_VALUE="COLE_AQUI"
MERCADOPAGO_CLIENT_SECRET_VALUE="COLE_AQUI"
MERCADOPAGO_WEBHOOK_SECRET_VALUE="COLE_AQUI"
MERCADOPAGO_TOKEN_ENCRYPTION_KEY_VALUE="COLE_AQUI"
FIREBASE_PROJECT_ID_VALUE="COLE_AQUI"
FIREBASE_CLIENT_EMAIL_VALUE="COLE_AQUI"
FIREBASE_PRIVATE_KEY_VALUE="COLE_AQUI"
SENTRY_DSN_VALUE="COLE_AQUI"

create_or_add_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    printf "%s" "$secret_value" | gcloud secrets versions add "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file=-
  else
    printf "%s" "$secret_value" | gcloud secrets create "$secret_name" \
      --project="$PROJECT_ID" \
      --replication-policy="automatic" \
      --data-file=-
  fi

  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

create_or_add_secret "revendasmart-mercadopago-access-token" "$MERCADOPAGO_ACCESS_TOKEN_VALUE"
create_or_add_secret "revendasmart-mercadopago-client-id" "$MERCADOPAGO_CLIENT_ID_VALUE"
create_or_add_secret "revendasmart-mercadopago-client-secret" "$MERCADOPAGO_CLIENT_SECRET_VALUE"
create_or_add_secret "revendasmart-mercadopago-webhook-secret" "$MERCADOPAGO_WEBHOOK_SECRET_VALUE"
create_or_add_secret "revendasmart-mercadopago-token-encryption-key" "$MERCADOPAGO_TOKEN_ENCRYPTION_KEY_VALUE"
create_or_add_secret "revendasmart-firebase-project-id" "$FIREBASE_PROJECT_ID_VALUE"
create_or_add_secret "revendasmart-firebase-client-email" "$FIREBASE_CLIENT_EMAIL_VALUE"
create_or_add_secret "revendasmart-firebase-private-key" "$FIREBASE_PRIVATE_KEY_VALUE"
create_or_add_secret "revendasmart-sentry-dsn" "$SENTRY_DSN_VALUE"

gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-secrets="MERCADOPAGO_ACCESS_TOKEN=revendasmart-mercadopago-access-token:latest,MERCADOPAGO_CLIENT_ID=revendasmart-mercadopago-client-id:latest,MERCADOPAGO_CLIENT_SECRET=revendasmart-mercadopago-client-secret:latest,MERCADOPAGO_WEBHOOK_SECRET=revendasmart-mercadopago-webhook-secret:latest,MERCADOPAGO_TOKEN_ENCRYPTION_KEY=revendasmart-mercadopago-token-encryption-key:latest,FIREBASE_PROJECT_ID=revendasmart-firebase-project-id:latest,FIREBASE_CLIENT_EMAIL=revendasmart-firebase-client-email:latest,FIREBASE_PRIVATE_KEY=revendasmart-firebase-private-key:latest,SENTRY_DSN=revendasmart-sentry-dsn:latest"
