#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: printf "%s" "$SECRET_VALUE" | scripts/security/update-secret-version.sh SECRET_NAME [PROJECT_ID]

Adds a new Secret Manager version reading the secret value from stdin.
The secret value is never printed.

Examples:
  printf "%s" "$MERCADOPAGO_ACCESS_TOKEN_VALUE" | \
    scripts/security/update-secret-version.sh revendasmart-mercadopago-access-token

  printf "%s" "$SENTRY_DSN_VALUE" | \
    scripts/security/update-secret-version.sh revendasmart-sentry-dsn revenda-smart
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SECRET_NAME="${1:-}"
PROJECT_ID="${2:-${PROJECT_ID:-revenda-smart}}"

if [[ -z "$SECRET_NAME" ]]; then
  echo "SECRET_NAME is required." >&2
  usage >&2
  exit 2
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID must be non-empty." >&2
  exit 2
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI not found." >&2
  exit 2
fi

if [[ -t 0 ]]; then
  echo "Secret value must be provided through stdin." >&2
  usage >&2
  exit 2
fi

if ! gcloud secrets describe "$SECRET_NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Secret does not exist: $SECRET_NAME" >&2
  echo "Create it first with: gcloud secrets create $SECRET_NAME --project $PROJECT_ID --replication-policy=automatic" >&2
  exit 1
fi

TMP_FILE="$(mktemp)"
cleanup() {
  if command -v shred >/dev/null 2>&1; then
    shred -u "$TMP_FILE" 2>/dev/null || rm -f "$TMP_FILE"
  else
    rm -f "$TMP_FILE"
  fi
}
trap cleanup EXIT

cat > "$TMP_FILE"

if [[ ! -s "$TMP_FILE" ]]; then
  echo "Refusing to add an empty secret version." >&2
  exit 2
fi

gcloud secrets versions add "$SECRET_NAME" \
  --project "$PROJECT_ID" \
  --data-file="$TMP_FILE" >/dev/null

echo "New version added for secret: $SECRET_NAME"
echo "Project: $PROJECT_ID"
echo "Secret value was not printed."
