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

npx --yes firebase-tools@latest deploy \
  --project "$STAGING_PROJECT_ID" \
  --config firebase.staging.json \
  --only firestore:rules,firestore:indexes,storage

