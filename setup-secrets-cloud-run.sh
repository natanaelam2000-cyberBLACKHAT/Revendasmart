#!/usr/bin/env bash
# =============================================================================
# setup-secrets-cloud-run.sh
# Creates all secrets in Google Cloud Secret Manager for RevendaSmart Backend
#
# Run ONCE before first deploy.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated
#   2. gcloud project set: gcloud config set project YOUR_PROJECT_ID
#   3. Secret Manager API enabled: gcloud services enable secretmanager.googleapis.com
#
# Usage:
#   export GCLOUD_PROJECT_ID=your-project-id
#   ./setup-secrets-cloud-run.sh
# =============================================================================

set -e

PROJECT_ID="${GCLOUD_PROJECT_ID:-YOUR_PROJECT_ID}"

if [ "$PROJECT_ID" = "YOUR_PROJECT_ID" ]; then
  echo "❌ ERROR: Set GCLOUD_PROJECT_ID env var first"
  echo "   export GCLOUD_PROJECT_ID=my-gcp-project"
  exit 1
fi

echo "🔐 Setting up secrets in Cloud Secret Manager"
echo "   Project: $PROJECT_ID"
echo ""
echo "You will be prompted for each secret value."
echo "Paste and press Enter, then Ctrl+D to confirm."
echo ""

# Helper function to create a secret and add a version
create_secret() {
  local name=$1
  local description=$2
  
  echo "─────────────────────────────────────────────────"
  echo "📝 Secret: $name"
  echo "   $description"
  echo ""
  
  # Create the secret (ignore error if already exists)
  gcloud secrets create "$name" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" 2>/dev/null || echo "   (Secret already exists, adding new version)"
  
  echo "   Paste value (then press Enter + Ctrl+D):"
  # Read value from stdin and add as new version
  gcloud secrets versions add "$name" \
    --project="$PROJECT_ID" \
    --data-file=-
  
  echo "✅ $name set"
  echo ""
}

# ── Mercado Pago Secrets ─────────────────────────────────────────────────────
echo "═══ MERCADO PAGO ════════════════════════════════"
echo "Find these in: https://www.mercadopago.com.br/developers/panel"
echo ""

create_secret "MERCADOPAGO_ACCESS_TOKEN" \
  "Central MP access token (for app subscriptions)"

create_secret "MERCADOPAGO_CLIENT_ID" \
  "MP OAuth App Client ID"

create_secret "MERCADOPAGO_CLIENT_SECRET" \
  "MP OAuth App Client Secret"

create_secret "MERCADOPAGO_TOKEN_ENCRYPTION_KEY" \
  "Encryption key for storing reseller OAuth tokens"

create_secret "MERCADOPAGO_WEBHOOK_SECRET" \
  "Webhook signature verification secret"

# ── Firebase Admin Secrets ───────────────────────────────────────────────────
echo "═══ FIREBASE ADMIN ══════════════════════════════"
echo "Find these in: Firebase Console → Project Settings → Service Accounts"
echo ""

create_secret "FIREBASE_PROJECT_ID" \
  "Firebase project ID (e.g. revenda-smart)"

create_secret "FIREBASE_CLIENT_EMAIL" \
  "Service account email (firebase-adminsdk-...@project.iam.gserviceaccount.com)"

create_secret "FIREBASE_PRIVATE_KEY" \
  "Private key (-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n)"

# ── Summary ──────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════"
echo "✅ ALL SECRETS CREATED"
echo ""
echo "Verify with:"
echo "  gcloud secrets list --project=$PROJECT_ID"
echo ""
echo "Grant Cloud Run access to secrets:"
echo ""
echo "  PROJECT_NUMBER=\$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')"
echo "  SA=\"\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com\""
echo ""
echo "  for SECRET in MERCADOPAGO_ACCESS_TOKEN MERCADOPAGO_CLIENT_ID \\"
echo "      MERCADOPAGO_CLIENT_SECRET MERCADOPAGO_TOKEN_ENCRYPTION_KEY \\"
echo "      MERCADOPAGO_WEBHOOK_SECRET FIREBASE_PROJECT_ID \\"
echo "      FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY; do"
echo "    gcloud secrets add-iam-policy-binding \$SECRET \\"
echo "      --project=$PROJECT_ID \\"
echo "      --member=\"serviceAccount:\$SA\" \\"
echo "      --role=\"roles/secretmanager.secretAccessor\""
echo "  done"
echo ""
echo "Then run: ./deploy-cloud-run.sh"
