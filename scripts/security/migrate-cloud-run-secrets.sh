#!/usr/bin/env bash
set -euo pipefail

# RevendaSmart — migrate Cloud Run sensitive env vars to Secret Manager.
#
# This script creates/adds Secret Manager versions from local environment variables
# ending in _VALUE and updates Cloud Run with --update-secrets.
#
# IMPORTANT:
# - Do not put real values in this file.
# - Export values only in your local shell/session.
# - Running this script creates a new Cloud Run revision.
# - Validate the new revision before deleting/rotating old credentials.
# - The script never prints secret values.

PROJECT_ID="${PROJECT_ID:-revenda-smart}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-revendasmart-backend}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-764966803100-compute@developer.gserviceaccount.com}"

REQUIRED_VALUE_VARS=(
  MERCADOPAGO_ACCESS_TOKEN_VALUE
  MERCADOPAGO_CLIENT_ID_VALUE
  MERCADOPAGO_CLIENT_SECRET_VALUE
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY_VALUE
  MERCADOPAGO_WEBHOOK_SECRET_VALUE
  FIREBASE_PROJECT_ID_VALUE
  FIREBASE_CLIENT_EMAIL_VALUE
  FIREBASE_PRIVATE_KEY_VALUE
  SENTRY_DSN_VALUE
)

declare -A SECRET_BY_VALUE_VAR=(
  [MERCADOPAGO_ACCESS_TOKEN_VALUE]="revendasmart-mercadopago-access-token"
  [MERCADOPAGO_CLIENT_ID_VALUE]="revendasmart-mercadopago-client-id"
  [MERCADOPAGO_CLIENT_SECRET_VALUE]="revendasmart-mercadopago-client-secret"
  [MERCADOPAGO_TOKEN_ENCRYPTION_KEY_VALUE]="revendasmart-mercadopago-token-encryption-key"
  [MERCADOPAGO_WEBHOOK_SECRET_VALUE]="revendasmart-mercadopago-webhook-secret"
  [FIREBASE_PROJECT_ID_VALUE]="revendasmart-firebase-project-id"
  [FIREBASE_CLIENT_EMAIL_VALUE]="revendasmart-firebase-client-email"
  [FIREBASE_PRIVATE_KEY_VALUE]="revendasmart-firebase-private-key"
  [SENTRY_DSN_VALUE]="revendasmart-sentry-dsn"
)

declare -A ENV_BY_SECRET=(
  [revendasmart-mercadopago-access-token]="MERCADOPAGO_ACCESS_TOKEN"
  [revendasmart-mercadopago-client-id]="MERCADOPAGO_CLIENT_ID"
  [revendasmart-mercadopago-client-secret]="MERCADOPAGO_CLIENT_SECRET"
  [revendasmart-mercadopago-token-encryption-key]="MERCADOPAGO_TOKEN_ENCRYPTION_KEY"
  [revendasmart-mercadopago-webhook-secret]="MERCADOPAGO_WEBHOOK_SECRET"
  [revendasmart-firebase-project-id]="FIREBASE_PROJECT_ID"
  [revendasmart-firebase-client-email]="FIREBASE_CLIENT_EMAIL"
  [revendasmart-firebase-private-key]="FIREBASE_PRIVATE_KEY"
  [revendasmart-sentry-dsn]="SENTRY_DSN"
)

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env_values() {
  local missing=0
  for var_name in "${REQUIRED_VALUE_VARS[@]}"; do
    if [[ -z "${!var_name:-}" ]]; then
      echo "Missing required environment variable: ${var_name}" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    echo "Export all required *_VALUE variables before running. No secrets were printed." >&2
    exit 1
  fi
}

create_or_add_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    printf "%s" "$secret_value" | gcloud secrets versions add "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file=- >/dev/null
    echo "Added new version for secret: ${secret_name}"
  else
    printf "%s" "$secret_value" | gcloud secrets create "$secret_name" \
      --project="$PROJECT_ID" \
      --replication-policy="automatic" \
      --data-file=- >/dev/null
    echo "Created secret: ${secret_name}"
  fi

  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
  echo "Granted secretAccessor to Cloud Run service account for: ${secret_name}"
}

build_update_secrets_arg() {
  local entries=()
  for value_var in "${REQUIRED_VALUE_VARS[@]}"; do
    local secret_name="${SECRET_BY_VALUE_VAR[$value_var]}"
    local env_name="${ENV_BY_SECRET[$secret_name]}"
    entries+=("${env_name}=${secret_name}:latest")
  done
  local IFS=,
  echo "${entries[*]}"
}

main() {
  require_command gcloud
  require_env_values

  echo "Project: ${PROJECT_ID}"
  echo "Region: ${REGION}"
  echo "Service: ${SERVICE}"
  echo "Service account: ${SERVICE_ACCOUNT}"
  echo "Enabling Secret Manager API if needed..."
  gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

  for value_var in "${REQUIRED_VALUE_VARS[@]}"; do
    create_or_add_secret "${SECRET_BY_VALUE_VAR[$value_var]}" "${!value_var}"
  done

  local update_secrets_arg
  update_secrets_arg="$(build_update_secrets_arg)"

  echo "Updating Cloud Run secrets. This creates a new revision."
  gcloud run services update "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --update-secrets="$update_secrets_arg"

  echo "Cloud Run secret migration command completed. Validate /health and critical flows before removing old secret versions."
}

main "$@"
