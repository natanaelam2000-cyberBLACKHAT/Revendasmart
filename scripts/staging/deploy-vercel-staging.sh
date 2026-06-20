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

if [ ! -f .vercel/project.json ]; then
  echo "ERROR: Vercel project is not linked. Link the separate staging project first." >&2
  exit 1
fi
linked_project="$(node -e 'const p=require("./.vercel/project.json"); process.stdout.write(p.projectName || "")')"
if [ "$linked_project" != "$STAGING_VERCEL_PROJECT" ]; then
  echo "ERROR: linked Vercel project is '$linked_project', expected '$STAGING_VERCEL_PROJECT'." >&2
  exit 1
fi

required_frontend=(
  VITE_API_BASE_URL VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_MESSAGING_SENDER_ID VITE_FIREBASE_APP_ID
)
for name in "${required_frontend[@]}"; do
  if [ -z "${!name:-}" ] || [[ "${!name}" == *"CHANGE_ME"* ]]; then
    echo "ERROR: missing frontend value $name" >&2
    exit 1
  fi
done

generated_config="$(mktemp)"
trap 'rm -f "$generated_config"' EXIT
node - "$STAGING_BACKEND_URL" "$generated_config" <<'NODE'
const fs = require("fs");
const [backendUrl, output] = process.argv.slice(2);
const template = fs.readFileSync("vercel.staging.template.json", "utf8");
fs.writeFileSync(output, template.replaceAll("__STAGING_BACKEND_URL__", backendUrl));
NODE

# Run `npx vercel link` once in the separate staging Vercel project.
# This intentionally creates a Preview deployment, not a production deployment.
npx --yes vercel@latest deploy \
  --yes \
  --local-config "$generated_config" \
  --build-env VITE_API_BASE_URL="$VITE_API_BASE_URL" \
  --build-env VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
  --build-env VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-env VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
  --build-env VITE_FIREBASE_STORAGE_BUCKET="$VITE_FIREBASE_STORAGE_BUCKET" \
  --build-env VITE_FIREBASE_MESSAGING_SENDER_ID="$VITE_FIREBASE_MESSAGING_SENDER_ID" \
  --build-env VITE_FIREBASE_APP_ID="$VITE_FIREBASE_APP_ID"

