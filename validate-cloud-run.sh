#!/usr/bin/env bash
# =============================================================================
# validate-cloud-run.sh
# Validates all critical routes on the Cloud Run deployment
# Run BEFORE pointing frontend or registering webhooks
#
# Usage:
#   export CLOUD_RUN_URL=https://revendasmart-backend-xxxx-uc.a.run.app
#   export FIREBASE_ID_TOKEN=eyJhbGciOiJSUz...   (get from browser console)
#   ./validate-cloud-run.sh
# =============================================================================

set -e

BASE_URL="${CLOUD_RUN_URL:-}"
TOKEN="${FIREBASE_ID_TOKEN:-}"

if [ -z "$BASE_URL" ]; then
  echo "❌ ERROR: Set CLOUD_RUN_URL"
  echo "   export CLOUD_RUN_URL=https://your-service-xxxx-uc.a.run.app"
  exit 1
fi

PASS=0
FAIL=0

check() {
  local label=$1
  local url=$2
  local method=${3:-GET}
  local body=${4:-}
  local expected_status=${5:-200}
  local auth_header=""
  
  if [ -n "$TOKEN" ]; then
    auth_header="-H \"Authorization: Bearer ${TOKEN}\""
  fi
  
  if [ -n "$body" ]; then
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d "$body" \
      "${BASE_URL}${url}" 2>/dev/null)
  else
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      -H "Authorization: Bearer ${TOKEN}" \
      "${BASE_URL}${url}" 2>/dev/null)
  fi
  
  if [ "$STATUS" = "$expected_status" ]; then
    echo "✅ [$STATUS] $label"
    PASS=$((PASS + 1))
  else
    echo "❌ [$STATUS] $label (expected $expected_status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "════════════════════════════════════════════════"
echo "🔍 Validating Cloud Run: $BASE_URL"
echo "════════════════════════════════════════════════"
echo ""

# ── 1. Health ────────────────────────────────────────────────────────────────
echo "── Infrastructure ─────────────────────────────"
check "Health endpoint" "/health"

# ── 2. CORS preflight ────────────────────────────────────────────────────────
echo ""
echo "── CORS ────────────────────────────────────────"
CORS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Origin: https://revendasmart.vercel.app" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  "${BASE_URL}/api/app-subscription/status" 2>/dev/null)
if [ "$CORS_STATUS" = "200" ] || [ "$CORS_STATUS" = "204" ]; then
  echo "✅ [$CORS_STATUS] CORS preflight (Vercel origin)"
  PASS=$((PASS + 1))
else
  echo "❌ [$CORS_STATUS] CORS preflight (expected 200/204)"
  FAIL=$((FAIL + 1))
fi

# ── 3. Auth-protected routes (need token) ────────────────────────────────────
echo ""
echo "── Auth (requires FIREBASE_ID_TOKEN) ──────────"
if [ -z "$TOKEN" ]; then
  echo "⚠️  SKIPPED — FIREBASE_ID_TOKEN not set"
  echo "   Get it from browser console:"
  echo "   firebase.auth().currentUser.getIdToken(true).then(t => console.log(t))"
else
  # App subscriptions
  check "GET /api/app-subscription/status" "/api/app-subscription/status"
  check "GET /api/admin/global-config" "/api/admin/global-config"
  
  # Legal (public)
  check "GET /api/legal/privacy-policy (public)" "/api/legal/privacy-policy" "GET" "" "200"
  check "GET /api/legal/terms-of-service (public)" "/api/legal/terms-of-service" "GET" "" "200"
  
  # MP connections
  check "GET /api/mercadopago/connections" "/api/mercadopago/connections"
  
  # Payments
  check "POST /api/payments/status (no body)" "/api/payments/status" "POST" "{}" "400"
fi

# ── 4. Webhook endpoints (must accept POST without auth) ──────────────────────
echo ""
echo "── Webhooks (unauthenticated POST) ─────────────"
WH1=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"test","data":{}}' \
  "${BASE_URL}/api/payments/webhook" 2>/dev/null)
if [ "$WH1" = "200" ] || [ "$WH1" = "400" ] || [ "$WH1" = "403" ]; then
  echo "✅ [$WH1] POST /api/payments/webhook reachable"
  PASS=$((PASS + 1))
else
  echo "❌ [$WH1] POST /api/payments/webhook (expected 200/400/403)"
  FAIL=$((FAIL + 1))
fi

WH2=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"test","data":{}}' \
  "${BASE_URL}/api/app-subscription/webhook" 2>/dev/null)
if [ "$WH2" = "200" ] || [ "$WH2" = "400" ] || [ "$WH2" = "403" ]; then
  echo "✅ [$WH2] POST /api/app-subscription/webhook reachable"
  PASS=$((PASS + 1))
else
  echo "❌ [$WH2] POST /api/app-subscription/webhook (expected 200/400/403)"
  FAIL=$((FAIL + 1))
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "📊 Results: $PASS/$TOTAL passed"
if [ $FAIL -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED — Safe to proceed with cutover"
else
  echo "❌ $FAIL CHECKS FAILED — Do NOT proceed with cutover"
  echo ""
  echo "Debug:"
  echo "  gcloud logs read --service=revendasmart-backend --region=us-central1 --limit=50"
fi
echo "════════════════════════════════════════════════"
