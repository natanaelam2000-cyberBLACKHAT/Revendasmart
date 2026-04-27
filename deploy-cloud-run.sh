#!/usr/bin/env bash
# =============================================================================
# deploy-cloud-run.sh
# Manual deploy script for RevendaSmart Backend → Google Cloud Run
#
# Usage: ./deploy-cloud-run.sh
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated (gcloud auth login)
#   2. gcloud project configured (gcloud config set project YOUR_PROJECT_ID)
#   3. APIs enabled (see CLOUD_RUN_MIGRATION.md)
#   4. Secrets created in Secret Manager (see CLOUD_RUN_MIGRATION.md)
# =============================================================================

set -e  # Exit on error

# ── CONFIGURATION (edit these) ──────────────────────────────────────────────
PROJECT_ID="${GCLOUD_PROJECT_ID:-YOUR_PROJECT_ID}"
REGION="${GCLOUD_REGION:-us-central1}"
SERVICE_NAME="revendasmart-backend"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# ── VALIDATION ───────────────────────────────────────────────────────────────
if [ "$PROJECT_ID" = "YOUR_PROJECT_ID" ]; then
  echo "❌ ERROR: Set GCLOUD_PROJECT_ID env var or edit this script"
  echo "   export GCLOUD_PROJECT_ID=my-gcp-project"
  exit 1
fi

echo "🚀 Deploy RevendaSmart Backend → Cloud Run"
echo "   Project:  $PROJECT_ID"
echo "   Region:   $REGION"
echo "   Service:  $SERVICE_NAME"
echo ""

# ── STEP 1: Build Docker image locally ──────────────────────────────────────
echo "📦 Step 1/4: Building Docker image..."
docker build -t "${IMAGE_NAME}:latest" .
echo "✅ Image built"

# ── STEP 2: Push to Container Registry ──────────────────────────────────────
echo ""
echo "⬆️  Step 2/4: Pushing image to GCR..."
docker push "${IMAGE_NAME}:latest"
echo "✅ Image pushed"

# ── STEP 3: Deploy to Cloud Run ──────────────────────────────────────────────
echo ""
echo "🌐 Step 3/4: Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_NAME}:latest" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --concurrency=80 \
  --min-instances=0 \
  --max-instances=10 \
  --timeout=300s \
  --set-secrets="MERCADOPAGO_ACCESS_TOKEN=MERCADOPAGO_ACCESS_TOKEN:latest,MERCADOPAGO_CLIENT_ID=MERCADOPAGO_CLIENT_ID:latest,MERCADOPAGO_CLIENT_SECRET=MERCADOPAGO_CLIENT_SECRET:latest,MERCADOPAGO_TOKEN_ENCRYPTION_KEY=MERCADOPAGO_TOKEN_ENCRYPTION_KEY:latest,MERCADOPAGO_WEBHOOK_SECRET=MERCADOPAGO_WEBHOOK_SECRET:latest,FIREBASE_PROJECT_ID=FIREBASE_PROJECT_ID:latest,FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest" \
  --set-env-vars="NODE_ENV=production,PORT=8080,FRONTEND_URL=https://revendasmart.vercel.app,PREMIUM_PRICE_BRL=19.9" \
  --project="${PROJECT_ID}"

echo "✅ Deployed to Cloud Run"

# ── STEP 4: Get URL and test health ─────────────────────────────────────────
echo ""
echo "🔍 Step 4/4: Getting service URL and testing health..."
CLOUD_RUN_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo "✅ Cloud Run URL: ${CLOUD_RUN_URL}"

# Test healthcheck
echo ""
echo "🏥 Testing /health endpoint..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${CLOUD_RUN_URL}/health")
if [ "$HEALTH_RESPONSE" = "200" ]; then
  echo "✅ Health check: OK (200)"
else
  echo "⚠️  Health check returned: $HEALTH_RESPONSE"
  echo "   Check Cloud Run logs: gcloud logs read --service=${SERVICE_NAME} --region=${REGION}"
fi

# ── SUMMARY ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "✅ DEPLOY COMPLETE"
echo ""
echo "  Cloud Run URL: ${CLOUD_RUN_URL}"
echo "  Health:        ${CLOUD_RUN_URL}/health"
echo ""
echo "⚠️  NEXT STEPS (DO NOT SKIP):"
echo "  1. Test all critical routes (see CLOUD_RUN_MIGRATION.md)"
echo "  2. Update APP_BASE_URL in Cloud Run to: ${CLOUD_RUN_URL}"
echo "     gcloud run services update ${SERVICE_NAME} \\"
echo "       --region=${REGION} \\"
echo "       --update-env-vars=APP_BASE_URL=${CLOUD_RUN_URL}"
echo "  3. Update MERCADOPAGO_REDIRECT_URI in Secret Manager"
echo "  4. Update webhook in Mercado Pago dashboard"
echo "  5. Only then point frontend to new URL"
echo "════════════════════════════════════════════════════════"
