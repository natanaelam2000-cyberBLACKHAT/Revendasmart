#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-revenda-smart}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-revendasmart-backend}"

usage() {
  cat <<'USAGE'
Usage: scripts/security/verify-cloud-run-secrets.sh [--project PROJECT_ID] [--region REGION] [--service SERVICE]

Checks whether sensitive Cloud Run environment variables are backed by Secret Manager.
Only variable names and statuses are printed. Values are never printed.

Defaults:
  PROJECT_ID=revenda-smart
  REGION=us-central1
  SERVICE=revendasmart-backend
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --service)
      SERVICE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$REGION" || -z "$SERVICE" ]]; then
  echo "PROJECT_ID, REGION and SERVICE must be non-empty." >&2
  exit 2
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI not found." >&2
  exit 2
fi

TMP_JSON="$(mktemp)"
cleanup() {
  rm -f "$TMP_JSON"
}
trap cleanup EXIT

gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format=json > "$TMP_JSON"

printf 'Cloud Run Secret Manager verification\n'
printf 'Project: %s\nRegion: %s\nService: %s\n\n' "$PROJECT_ID" "$REGION" "$SERVICE"
printf '%-40s %s\n' "ENV" "STATUS"
printf '%-40s %s\n' "---" "---"

python3 - "$TMP_JSON" <<'PY'
import json
import sys

required = [
    "MERCADOPAGO_ACCESS_TOKEN",
    "MERCADOPAGO_CLIENT_ID",
    "MERCADOPAGO_CLIENT_SECRET",
    "MERCADOPAGO_TOKEN_ENCRYPTION_KEY",
    "MERCADOPAGO_WEBHOOK_SECRET",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
]
optional = ["SENTRY_DSN"]

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    service = json.load(handle)

containers = service.get("spec", {}).get("template", {}).get("spec", {}).get("containers") or []
if not containers:
    print("No containers found in Cloud Run service.", file=sys.stderr)
    sys.exit(3)

envs = containers[0].get("env") or []
by_name = {entry.get("name"): entry for entry in envs if entry.get("name")}
failed = False

for name in required:
    entry = by_name.get(name)
    if entry is None:
        status = "missing"
        failed = True
    elif entry.get("valueFrom", {}).get("secretKeyRef"):
        status = "secret"
    else:
        status = "plain"
        failed = True
    print(f"{name:<40} {status}")

for name in optional:
    entry = by_name.get(name)
    if entry is None:
        status = "optional-missing"
    elif entry.get("valueFrom", {}).get("secretKeyRef"):
        status = "secret"
    else:
        status = "plain-optional"
    print(f"{name:<40} {status}")

if failed:
    print("\nFAIL: one or more required sensitive envs are plain or missing.", file=sys.stderr)
    sys.exit(1)

print("\nOK: all required sensitive envs are backed by Secret Manager.")
PY
