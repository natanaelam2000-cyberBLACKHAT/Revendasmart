#!/usr/bin/env bash
set -euo pipefail

required=(
  CONFIRM_STAGING STAGING_PROJECT_ID STAGING_REGION STAGING_SERVICE
  STAGING_RUNTIME_SERVICE_ACCOUNT STAGING_VERCEL_PROJECT
  STAGING_FRONTEND_URL STAGING_BACKEND_URL
)

for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "ERROR: missing $name. Copy .env.staging.example to .env.staging." >&2
    exit 1
  fi
done

if [ "$CONFIRM_STAGING" != "$STAGING_PROJECT_ID" ]; then
  echo "ERROR: CONFIRM_STAGING must exactly match STAGING_PROJECT_ID." >&2
  exit 1
fi

case "$STAGING_PROJECT_ID" in
  revenda-smart|revenda-smart-prod|*production*|*prod)
    echo "ERROR: production-like project rejected: $STAGING_PROJECT_ID" >&2
    exit 1
    ;;
esac

if [ "$STAGING_SERVICE" != "revendasmart-backend-staging" ]; then
  echo "ERROR: unexpected service name: $STAGING_SERVICE" >&2
  exit 1
fi

if [[ "$STAGING_RUNTIME_SERVICE_ACCOUNT" != *"@$STAGING_PROJECT_ID.iam.gserviceaccount.com" ]]; then
  echo "ERROR: runtime service account does not belong to staging project." >&2
  exit 1
fi

if [ "$STAGING_VERCEL_PROJECT" != "revendasmart-staging" ]; then
  echo "ERROR: unexpected Vercel project: $STAGING_VERCEL_PROJECT" >&2
  exit 1
fi

for name in FIREBASE_PROJECT_ID VITE_FIREBASE_PROJECT_ID; do
  if [ -n "${!name:-}" ] && [ "${!name}" != "$STAGING_PROJECT_ID" ]; then
    echo "ERROR: $name does not match STAGING_PROJECT_ID." >&2
    exit 1
  fi
done

if [ -n "${VITE_API_BASE_URL:-}" ] && [ "$VITE_API_BASE_URL" != "$STAGING_BACKEND_URL" ]; then
  echo "ERROR: VITE_API_BASE_URL does not match STAGING_BACKEND_URL." >&2
  exit 1
fi

for value in "$STAGING_FRONTEND_URL" "$STAGING_BACKEND_URL"; do
  if [[ "$value" == *"revendasmart.vercel.app"* ]] ||
     [[ "$value" == *"revendasmart-backend-cc2743rkmq"* ]]; then
    echo "ERROR: production URL rejected: $value" >&2
    exit 1
  fi
  if [[ "$value" == *"CHANGE_ME"* ]]; then
    echo "ERROR: placeholder URL must be replaced: $value" >&2
    exit 1
  fi
done

if [ "${NODE_ENV:-staging}" != "staging" ]; then
  echo "ERROR: NODE_ENV must be staging." >&2
  exit 1
fi

echo "Staging isolation guard: OK ($STAGING_PROJECT_ID / $STAGING_SERVICE)"
